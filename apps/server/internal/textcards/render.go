package textcards

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"math"
	"strconv"
	"strings"

	"github.com/disintegration/imaging"
	textrender "github.com/go-text/render"
)

type Identity struct {
	Name   string `json:"name"`
	Handle string `json:"handle"`
}

type Image struct {
	JPEG          []byte
	Width, Height int
}

func Render(ctx context.Context, body, outputProfile string, style Style, identity Identity, avatar image.Image, attachments int) ([]Image, error) {
	pages, err := Layout(body, outputProfile)
	if err != nil {
		return nil, err
	}
	faces, err := newFaces()
	if err != nil {
		return nil, err
	}
	var result []Image
	for index, page := range pages {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		canvas := image.NewNRGBA(image.Rect(0, 0, Width, page.Height))
		paintBackground(canvas, style)
		contentHeight := len(page.lines) * lineHeight(page.size)
		cardHeight := max(380, contentHeight+244)
		top := (page.Height - cardHeight) / 2
		card := image.Rect(80, top, 1000, top+cardHeight)
		radius := 0
		if style.Rounded {
			radius = 32
		}
		ink, muted, paper := parseColor("#18181b"), parseColor("#6b7280"), parseColor("#ffffff")
		if style.Appearance == "dark" {
			ink, muted, paper = parseColor("#f4f4f5"), parseColor("#a1a1aa"), parseColor("#18181b")
		}
		if style.Shadow {
			shadow := image.NewNRGBA(canvas.Bounds())
			paintRounded(shadow, card.Add(image.Pt(0, 18)), radius, color.NRGBA{A: 65})
			draw.Draw(canvas, canvas.Bounds(), imaging.Blur(shadow, 22), image.Point{}, draw.Over)
		}
		paintRounded(canvas, card, radius, paper)
		paintAvatar(canvas, avatar, identity.Name, faces, top)
		drawLabel(canvas, wrapText(identity.Name, faces, 34, 690), 238, top+86, 690, ink)
		handle := strings.TrimPrefix(identity.Handle, "@")
		if handle != "" {
			handle = "@" + handle
		}
		drawLabel(canvas, wrapText(handle, faces, 27, 690), 238, top+123, 690, muted)
		y := top + 188 + page.size
		for _, line := range page.lines {
			drawLine(canvas, line, 136, y, textWidth, ink)
			y += lineHeight(page.size)
		}
		more := index+1 < len(pages) || attachments > 0
		if more {
			footerY := card.Max.Y - 43
			paintArrow(canvas, 896, footerY-8, muted)
			if len(pages) > 1 {
				drawLabel(canvas, wrapText(fmt.Sprintf("%d / %d", index+1, len(pages)+attachments), faces, 23, 200), 136, footerY, 200, muted)
			}
		}
		var buffer bytes.Buffer
		if err := jpeg.Encode(&buffer, canvas, &jpeg.Options{Quality: 94}); err != nil {
			return nil, err
		}
		result = append(result, Image{JPEG: buffer.Bytes(), Width: Width, Height: page.Height})
	}
	return result, nil
}

func drawLabel(canvas *image.NRGBA, lines []line, x, y, width int, ink color.NRGBA) {
	if len(lines) > 0 {
		drawLine(canvas, lines[0], x, y, width, ink)
	}
}

func drawLine(canvas *image.NRGBA, item line, x, y, width int, ink color.NRGBA) {
	if item.rtl {
		x += width - item.width
	}
	var renderer textrender.Renderer
	renderer.Color = ink
	for _, run := range item.runs {
		renderer.FontSize = float32(run.Size) / 64
		renderer.PixScale = 1
		x = renderer.DrawShapedRunAt(run, canvas, x, y)
	}
}

func parseColor(value string) color.NRGBA {
	rgb, _ := strconv.ParseUint(strings.TrimPrefix(value, "#"), 16, 32)
	return color.NRGBA{R: uint8(rgb >> 16), G: uint8(rgb >> 8), B: uint8(rgb), A: 255}
}

func paintBackground(canvas *image.NRGBA, style Style) {
	from, to := parseColor(style.Color), parseColor(style.ColorEnd)
	for y := 0; y < canvas.Bounds().Dy(); y++ {
		for x := 0; x < Width; x++ {
			u, v := float64(x)/Width, float64(y)/float64(canvas.Bounds().Dy())
			t := 0.0
			switch style.Background {
			case "gradient":
				t = (u + v) / 2
			case "mesh":
				t = min(1, max(0, 0.5+0.3*math.Sin(u*5+v*3)+0.2*math.Cos(v*6-u*2)))
			}
			canvas.SetNRGBA(x, y, color.NRGBA{R: uint8(float64(from.R)*(1-t) + float64(to.R)*t), G: uint8(float64(from.G)*(1-t) + float64(to.G)*t), B: uint8(float64(from.B)*(1-t) + float64(to.B)*t), A: 255})
		}
	}
}

func paintRounded(canvas *image.NRGBA, rect image.Rectangle, radius int, ink color.NRGBA) {
	for y := rect.Min.Y; y < rect.Max.Y; y++ {
		for x := rect.Min.X; x < rect.Max.X; x++ {
			dx := max(rect.Min.X+radius-x, x-(rect.Max.X-radius-1), 0)
			dy := max(rect.Min.Y+radius-y, y-(rect.Max.Y-radius-1), 0)
			if dx*dx+dy*dy <= radius*radius {
				canvas.SetNRGBA(x, y, ink)
			}
		}
	}
}

func paintArrow(canvas *image.NRGBA, x, y int, ink color.NRGBA) {
	for dx := 0; dx < 34; dx++ {
		for d := -2; d <= 2; d++ {
			canvas.SetNRGBA(x+dx, y+d, ink)
		}
	}
	for i := 0; i < 14; i++ {
		for d := -2; d <= 2; d++ {
			canvas.SetNRGBA(x+33-i, y-i+d, ink)
			canvas.SetNRGBA(x+33-i, y+i+d, ink)
		}
	}
}

func paintAvatar(canvas *image.NRGBA, avatar image.Image, name string, faces fontMap, top int) {
	avatarRect := image.Rect(136, top+54, 214, top+132)
	paintRounded(canvas, avatarRect, 39, parseColor("#c4b5fd"))
	if avatar != nil {
		photo := imaging.Fill(avatar, 78, 78, imaging.Center, imaging.Lanczos)
		mask := image.NewAlpha(image.Rect(0, 0, 78, 78))
		for y := 0; y < 78; y++ {
			for x := 0; x < 78; x++ {
				if math.Hypot(float64(x)-38.5, float64(y)-38.5) <= 39 {
					mask.SetAlpha(x, y, color.Alpha{A: 255})
				}
			}
		}
		draw.DrawMask(canvas, avatarRect, photo, image.Point{}, mask, image.Point{}, draw.Over)
	} else {
		initial := "O"
		if runes := []rune(strings.TrimSpace(name)); len(runes) > 0 {
			initial = strings.ToUpper(string(runes[0]))
		}
		drawLabel(canvas, wrapText(initial, faces, 36, 70), 154, top+108, 70, parseColor("#312e81"))
	}
}
