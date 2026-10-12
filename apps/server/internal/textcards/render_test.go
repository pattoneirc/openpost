package textcards

import (
	"bytes"
	"image/jpeg"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRenderDrawsReadableTextAndKeepsDeterministicBytes(t *testing.T) {
	style, err := Parse(map[string]any{"text_card": "always", "text_card_shadow": false})
	require.NoError(t, err)
	for _, text := range []string{"A new release.", "Olá, café!", "مرحبا بالعالم", "שלום עולם", "日本語の投稿", "Hello 👋 🌍"} {
		t.Run(text, func(t *testing.T) {
			images, err := Render(t.Context(), text, "instagram.feed", style, Identity{Name: "Founder", Handle: "founder"}, nil, 0)
			require.NoError(t, err)
			require.Len(t, images, 1)
			photo, err := jpeg.Decode(bytes.NewReader(images[0].JPEG))
			require.NoError(t, err)
			// This rectangle contains the body, below the identity and above the footer.
			ink := 0
			for y := 690; y < 770; y++ {
				for x := 136; x < 944; x++ {
					r, g, b, _ := photo.At(x, y).RGBA()
					if r < 16000 && g < 16000 && b < 16000 {
						ink++
					}
				}
			}
			require.Greater(t, ink, 100, "the body must contain visible glyphs")
			again, err := Render(t.Context(), text, "instagram.feed", style, Identity{Name: "Founder", Handle: "founder"}, nil, 0)
			require.NoError(t, err)
			require.Equal(t, images[0].JPEG, again[0].JPEG)
		})
	}
}

func TestLayoutPaginatesWithoutDroppingTextAndBoundsWork(t *testing.T) {
	body := strings.Repeat("We shipped a smaller, faster editor. ", 55)
	pages, err := Layout(body, "instagram.feed")
	require.NoError(t, err)
	require.Greater(t, len(pages), 1)
	characters := 0
	for _, page := range pages {
		for _, line := range page.lines {
			for _, run := range line.runs {
				characters += run.Runes.Count
			}
		}
	}
	require.Equal(t, len([]rune(strings.TrimSpace(body))), characters)
	_, err = Layout(strings.Repeat("x\n", 1000), "instagram.feed")
	require.ErrorContains(t, err, "more than 10 images")
	_, err = Layout(strings.Repeat("x", MaxCharacters+1), "instagram.feed")
	require.ErrorContains(t, err, "2200")
}
