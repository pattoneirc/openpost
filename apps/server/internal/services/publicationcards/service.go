// Package publicationcards snapshots generated text cards as ordinary media.
// The authored text and attachments remain separate from these delivery assets.
package publicationcards

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/gif" // Decode connected-account avatars.
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/netguard"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/medialifecycle"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/textcards"
	"github.com/uptrace/bun"
	_ "golang.org/x/image/webp" // Decode connected-account avatars.
)

type Service struct {
	db      *bun.DB
	storage mediastore.BlobStorage
	quota   entitlements.Service
	http    *http.Client
}

func New(db *bun.DB, storage mediastore.BlobStorage, quota entitlements.Service) *Service {
	if quota == nil {
		quota = entitlements.NewSelfHostedService()
	}
	return &Service{db: db, storage: storage, quota: quota, http: netguard.NewHTTPClient(5*time.Second, netguard.URLPolicy{Label: "profile photo", AllowedSchemes: []string{"https"}})}
}

type cleanupKey struct{}
type pendingAsset struct{ id, key, workspaceID string }

// Mutation compensates blob writes if the surrounding database transaction
// rolls back. Nested application calls share one cleanup scope.
func (s *Service) Mutation(ctx context.Context) (context.Context, func()) {
	if s == nil {
		return ctx, func() {}
	}
	if ctx.Value(cleanupKey{}) != nil {
		return ctx, func() {}
	}
	pending := []pendingAsset{}
	return context.WithValue(ctx, cleanupKey{}, &pending), func() {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		for _, asset := range pending {
			exists, err := s.db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("id = ?", asset.id).Exists(cleanupCtx)
			if err == nil && !exists {
				_ = s.storage.Delete(cleanupCtx, asset.key)
			}
		}
	}
}

func Identity(account models.SocialAccount) textcards.Identity {
	name := strings.TrimSpace(account.Alias)
	if name == "" {
		name = account.AccountUsername
	}
	if name == "" {
		name = account.Slug
	}
	return textcards.Identity{Name: name, Handle: account.AccountUsername}
}

func (s *Service) Preview(ctx context.Context, account models.SocialAccount, body, output string, style textcards.Style, attachments int) ([]textcards.Image, error) {
	avatar := s.avatar(ctx, account.AccountAvatarURL)
	return textcards.Render(ctx, body, output, style, Identity(account), avatar, attachments)
}

func (s *Service) avatar(ctx context.Context, raw string) image.Image {
	if raw == "" {
		return nil
	}
	reader, err := s.openAvatar(ctx, raw)
	if err != nil || reader == nil {
		return nil
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, 4*1024*1024+1))
	if err != nil || len(data) > 4*1024*1024 {
		return nil
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > 16_000_000 {
		return nil
	}
	photo, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil
	}
	return photo
}

// RefreshSegment changes only generated media relations. Existing output bytes
// are retained when the text, layout, identity and attachment count are unchanged.
func (s *Service) RefreshSegment(ctx context.Context, db bun.IDB, account models.SocialAccount, rendition models.Rendition, segment models.RenditionSegment, settings map[string]any) error {
	var rows []models.RenditionSegmentMedia
	if err := db.NewSelect().Model(&rows).Where("rendition_segment_id = ?", segment.ID).Order("display_order ASC").Scan(ctx); err != nil {
		return err
	}
	attachments, previous := segmentAttachments(rows)
	style, err := textcards.Parse(settings)
	if err != nil {
		return err
	}
	applies := style.Applies(account.Platform, rendition.OutputProfile, segment.Body, attachments)
	fingerprint, _ := json.Marshal(struct {
		Version              int
		Body, Output, Avatar string
		Style                textcards.Style
		Identity             textcards.Identity
		Attachments          int
	}{1, segment.Body, rendition.OutputProfile, account.AccountAvatarURL, style, Identity(account), attachments})
	hash := sha256.Sum256(fingerprint)
	receipt := string(mustJSON(map[string]string{"text_card_source": hex.EncodeToString(hash[:])}))
	if applies && len(previous) > 0 && previous[0].SettingsJSON == receipt {
		return nil
	}
	if _, err := db.NewDelete().Model((*models.RenditionSegmentMedia)(nil)).Where("rendition_segment_id = ? AND role = ?", segment.ID, textcards.MediaRole).Exec(ctx); err != nil {
		return err
	}
	if !applies {
		return nil
	}
	if s == nil || s.storage == nil {
		return errors.New("text card storage is unavailable")
	}
	if _, err := textcards.Layout(segment.Body, rendition.OutputProfile); err != nil {
		return nil
	} // Keep incomplete drafts editable.
	images, err := s.Preview(ctx, account, segment.Body, rendition.OutputProfile, style, attachments)
	if err != nil {
		return err
	}
	for index, img := range images {
		media, err := s.persist(ctx, db, account.WorkspaceID, segment.Body, img)
		if err != nil {
			return err
		}
		row := models.RenditionSegmentMedia{RenditionSegmentID: segment.ID, MediaID: media.ID, Role: textcards.MediaRole, DisplayOrder: index - len(images), AltText: segment.Body, SettingsJSON: receipt}
		if _, err := db.NewInsert().Model(&row).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) persist(ctx context.Context, db bun.IDB, workspaceID, body string, img textcards.Image) (models.MediaAttachment, error) {
	hash := sha256.Sum256(img.JPEG)
	fileHash := hex.EncodeToString(hash[:])
	var existing models.MediaAttachment
	err := db.NewSelect().Model(&existing).Where("workspace_id = ? AND file_hash = ? AND trashed_at IS NULL", workspaceID, fileHash).Scan(ctx)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return existing, err
	}
	id := uuid.NewString()
	key := id + ".jpg"
	storedPath, err := mediastore.SaveWithContentType(ctx, s.storage, key, bytes.NewReader(img.JPEG), "image/jpeg")
	if err != nil {
		_ = mediastore.DeleteForCleanup(ctx, s.storage, key)
		return existing, err
	}
	if pending, ok := ctx.Value(cleanupKey{}).(*[]pendingAsset); ok {
		*pending = append(*pending, pendingAsset{id: id, key: key, workspaceID: workspaceID})
	} else {
		_ = mediastore.DeleteForCleanup(ctx, s.storage, key)
		return existing, errors.New("text card mutation scope is missing")
	}
	media := models.MediaAttachment{ID: id, WorkspaceID: workspaceID, FilePath: storedPath, StorageType: s.storage.Driver(), MimeType: "image/jpeg", Size: int64(len(img.JPEG)), Width: img.Width, Height: img.Height, OriginalFilename: "text-card.jpg", FileHash: fileHash, Source: "text_card", AssetKind: "library", RetentionClass: "temporary", AltText: body, ProcessingStatus: "ready", ProcessingProgress: 100, AnalysisStatus: "ready", DominantType: "image", AspectRatio: fmt.Sprintf("%d:%d", img.Width, img.Height), ThumbnailsJSON: "{}", LastUsedAt: time.Now().UTC(), CreatedAt: time.Now().UTC()}
	_, err = db.NewInsert().Model(&media).Exec(ctx)
	return media, err
}

// Finalize runs after every rendition's delivery relations are restored. This
// admits the replacement's net storage, while transaction rollback restores old
// media and the Mutation scope removes any new files if admission fails.
func (s *Service) Finalize(ctx context.Context, tx bun.Tx, workspaceID string, previousIDs []string) error {
	if err := medialifecycle.RetireTextCards(ctx, tx, workspaceID, previousIDs); err != nil {
		return err
	}
	pending, _ := ctx.Value(cleanupKey{}).(*[]pendingAsset)
	if pending == nil {
		return nil
	}
	var ids []string
	for _, asset := range *pending {
		if asset.workspaceID == workspaceID {
			ids = append(ids, asset.id)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	var added int64
	if err := tx.NewSelect().Model((*models.MediaAttachment)(nil)).ColumnExpr("COALESCE(SUM(size), 0)").Where("id IN (?)", bun.List(ids)).Scan(ctx, &added); err != nil {
		return err
	}
	if added == 0 {
		return nil
	}
	stored, err := medialifecycle.StoredBytes(ctx, tx, workspaceID, "")
	if err != nil {
		return err
	}
	decision, err := s.quota.Check(ctx, entitlements.Request{WorkspaceID: workspaceID, Limit: entitlements.LimitMediaBytesStored, Current: stored - added, Amount: added})
	if err != nil {
		return err
	}
	if !decision.Allowed {
		return fmt.Errorf("text card storage: %s", decision.Reason)
	}
	return nil
}

func mustJSON(value any) []byte { data, _ := json.Marshal(value); return data }

func (s *Service) openAvatar(ctx context.Context, raw string) (io.ReadCloser, error) {
	var reader io.ReadCloser
	var err error
	if strings.HasPrefix(raw, "/avatars/") && s.storage != nil {
		reader, err = s.storage.Open(ctx, path.Base(raw))
	} else {
		remote, parseErr := url.Parse(raw)
		if parseErr != nil || remote.Scheme != "https" || remote.User != nil {
			return nil, nil
		}
		req, requestErr := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
		if requestErr != nil {
			return nil, nil
		}
		response, requestErr := s.http.Do(req)
		if requestErr != nil {
			return nil, nil
		}
		if response.StatusCode != http.StatusOK {
			_ = response.Body.Close()
			return nil, nil
		}
		reader = response.Body
	}
	if err != nil {
		return nil, nil
	}
	return reader, err
}

func segmentAttachments(rows []models.RenditionSegmentMedia) (int, []models.RenditionSegmentMedia) {
	attachments := 0
	var previous []models.RenditionSegmentMedia
	for _, row := range rows {
		if row.Role == textcards.MediaRole {
			previous = append(previous, row)
		} else {
			attachments++
		}
	}
	return attachments, previous
}
