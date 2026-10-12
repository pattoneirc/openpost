package capabilities

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestTextCardsResolveTheDeliveredMediaShape(t *testing.T) {
	for _, provider := range []string{ProviderInstagram, ProviderPixelfed} {
		t.Run(provider, func(t *testing.T) {
			resolved := Resolve(provider, ResolveInput{Settings: map[string]any{"text_card": "always"}, Segments: []ResolveSegment{{ID: "source", Body: "A small release worth sharing."}}})
			require.True(t, resolved.Compatible, "%+v", resolved.Issues)
			require.Equal(t, MediaShapeSingleImage, resolved.ActiveConstraints["media_shape"])
			withPhoto := Resolve(provider, ResolveInput{Settings: map[string]any{"text_card": "always"}, Segments: []ResolveSegment{{ID: "source", Body: "A small release worth sharing.", Media: []MediaItem{{ID: "photo", MimeType: "image/jpeg", Width: 1080, Height: 1350, PublicURLReady: true}}}}})
			require.True(t, withPhoto.Compatible, "%+v", withPhoto.Issues)
			require.Equal(t, provider+".carousel", withPhoto.OutputProfile)
		})
	}
}

func TestTextCardsRespectNativeFormatsAndCarouselLimits(t *testing.T) {
	story := Resolve(ProviderInstagram, ResolveInput{CreationPreset: "story", Settings: map[string]any{"text_card": "text_only"}, Segments: []ResolveSegment{{Body: "A story worth sharing."}}})
	require.True(t, story.Compatible, "%+v", story.Issues)
	require.Equal(t, "instagram.story", story.OutputProfile)
	photos := make([]MediaItem, 10)
	for i := range photos {
		photos[i] = MediaItem{ID: strings.Repeat("p", i+1), MimeType: "image/jpeg", Width: 1080, Height: 1350, PublicURLReady: true}
	}
	tooMany := Resolve(ProviderInstagram, ResolveInput{Settings: map[string]any{"text_card": "always"}, Segments: []ResolveSegment{{Body: "A caption.", Media: photos}}})
	require.False(t, tooMany.Compatible, "the generated image counts toward the carousel limit")
	unchanged := Resolve(ProviderInstagram, ResolveInput{RequestedOutputProfile: "instagram.carousel", Settings: map[string]any{"text_card": "text_only"}, Segments: []ResolveSegment{{Body: "A caption.", Media: photos}}})
	require.True(t, unchanged.Compatible, "%+v", unchanged.Issues)
	for _, mode := range []string{"off", "text_only"} {
		issues := ValidateOutput(ProviderInstagram, "instagram.carousel", "", strings.Repeat("x", 2201), "", "", photos, map[string]any{"text_card": mode})
		for _, issue := range issues {
			require.NotEqual(t, "text_card_invalid", issue.Code, "an ordinary media post uses native caption limits")
		}
	}
	reel := Resolve(ProviderInstagram, ResolveInput{RequestedOutputProfile: "instagram.reel", Settings: map[string]any{"text_card": "always"}, Segments: []ResolveSegment{{Body: "A reel still needs a video."}}})
	require.False(t, reel.Compatible)
	for _, issue := range reel.Issues {
		require.NotEqual(t, "text_card_applied", issue.Code)
	}
}

func TestTextCardsDeduplicateSharedSourceAttachments(t *testing.T) {
	photos := []MediaItem{{ID: "one", MimeType: "image/jpeg", Width: 1080, Height: 1350}, {ID: "two", MimeType: "image/jpeg", Width: 1080, Height: 1350}, {ID: "three", MimeType: "image/jpeg", Width: 1080, Height: 1350}}
	resolved := Resolve(ProviderPixelfed, ResolveInput{Settings: map[string]any{"text_card": "always"}, Segments: []ResolveSegment{{ID: "a", Body: "First", Media: photos}, {ID: "b", Body: "Second", Media: photos}}})
	require.True(t, resolved.Compatible, "%+v", resolved.Issues)
}
