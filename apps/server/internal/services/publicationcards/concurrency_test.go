package publicationcards

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/textcards"
	"github.com/stretchr/testify/require"
)

type blockingAvatarStorage struct {
	started chan struct{}
	release chan struct{}
}

func (*blockingAvatarStorage) Driver() string { return "local" }
func (*blockingAvatarStorage) Save(context.Context, string, io.Reader) (string, error) {
	return "", nil
}
func (*blockingAvatarStorage) Delete(context.Context, string) error { return nil }
func (*blockingAvatarStorage) GetURL(string) string                 { return "" }
func (s *blockingAvatarStorage) Open(context.Context, string) (io.ReadCloser, error) {
	s.started <- struct{}{}
	<-s.release
	return io.NopCloser(strings.NewReader("not an avatar")), nil
}

func TestPreviewBoundsRenderingAcrossServiceInstances(t *testing.T) {
	storage := &blockingAvatarStorage{started: make(chan struct{}, 3), release: make(chan struct{})}
	defer close(storage.release)
	account := models.SocialAccount{AccountAvatarURL: "/avatars/busy"}
	style := textcards.Style{Color: "#ffffff", ColorEnd: "#ffffff"}
	results := make(chan error, 3)
	for range 2 {
		go func() {
			_, err := New(nil, storage, nil).Preview(t.Context(), account, "Preview", "", style, 0)
			results <- err
		}()
		<-storage.started
	}
	go func() {
		_, err := New(nil, storage, nil).Preview(t.Context(), account, "Preview", "", style, 0)
		results <- err
	}()
	select {
	case err := <-results:
		require.Error(t, err, "a busy renderer must reject excess work")
	case <-time.After(time.Second):
		t.Fatal("third preview entered expensive work instead of rejecting it")
	}
}
