import { expect, test } from "bun:test";
import type { components } from "@openpost/api-contract";
import { mobileRenditionInput, mobileRenditionTextFields } from "./publication-renditions";

const rendition: components["schemas"]["RenditionResponse"] = {
  id: "destination",
  publication_id: "post",
  social_account_id: "founder",
  platform: "x",
  target_key: "x",
  profile: "short_text",
  output_profile: "x.video",
  format_locked: true,
  body: "Watch the demo",
  title: "",
  description: "",
  settings: { first_comment: "More detail" },
  schedule_override: "2026-10-12T09:00:00Z",
  status: "draft",
  error_retryable: false,
  media: [],
  segments: [
    {
      id: "variant-1",
      publication_segment_id: "source-1",
      position: 0,
      body: "Watch the demo",
      body_override: "Watch the demo",
      title: "",
      description: "",
      media: [],
      media_inherited: false,
      settings: {
        attachment_requirement: { kind: "video", brief: "Show the real demo" },
        poll: { question: "Try it?" },
      },
      status: "draft",
      error_retryable: false,
      source_overrides: [
        {
          publication_segment_id: "source-1",
          body_override: "First source",
          media_inherited: false,
          media: [],
        },
        { publication_segment_id: "source-2", media_inherited: true },
      ],
    },
  ],
};

test("saving an unchanged generated draft keeps its destination format, requirement, and source decisions", () => {
  const input = mobileRenditionInput(
    { renditions: [rendition], segments: [] },
    "founder",
    undefined,
    [],
  );
  expect(input.output_profile).toBe("x.video");
  expect(input.format_locked).toBe(true);
  expect(input.settings).toEqual({ first_comment: "More detail" });
  expect(input.schedule_override).toBe("2026-10-12T09:00:00Z");
  expect(input.segments?.[0]?.settings).toEqual({
    attachment_requirement: { kind: "video", brief: "Show the real demo" },
    poll: { question: "Try it?" },
  });
  expect(input.segments?.[0]?.media_inherited).toBe(false);
  expect(input.segments?.[0]?.media).toEqual([]);
  expect(input.segments?.[0]?.source_overrides).toEqual([
    {
      publication_segment_id: "source-1",
      body_override: "First source",
      media_inherited: false,
      media: [],
    },
    { publication_segment_id: "source-2", media_inherited: true },
  ]);
});

test("supplying a demo attaches only matching media to the required variant and preserves an explicit empty caption", () => {
  const standalone = {
    ...rendition,
    segments: (rendition.segments ?? []).map((segment) => ({
      ...segment,
      source_overrides: undefined,
    })),
  };
  const input = mobileRenditionInput(
    { renditions: [standalone], segments: [] },
    "founder",
    { "segment:0": "" },
    [
      { mediaId: "screenshot", mimeType: "image/png" },
      { mediaId: "demo", mimeType: "video/mp4" },
    ],
  );
  expect(input.segments?.[0]?.body_override).toBe("");
  expect(input.segments?.[0]?.source_overrides).toBeUndefined();
  expect(input.segments?.[0]?.media).toEqual([{ media_id: "demo" }]);
  expect(input.segments?.[0]?.settings?.attachment_requirement).toEqual({
    kind: "video",
    brief: "Show the real demo",
  });
});

test("editing one joined source keeps independent images, inherited continuation, and explicit omissions", () => {
  const custom = {
    media_id: "custom-image",
    alt_text: "Original authored caption",
    settings: { crop: "center" },
  };
  const sources = [
    {
      publication_segment_id: "source-1",
      body_override: "Independent first",
      media_inherited: false,
      media: [custom],
    },
    { publication_segment_id: "source-2", media_inherited: true },
    { publication_segment_id: "source-3", body_override: "", media_inherited: false, media: [] },
  ];
  const joined = {
    ...rendition,
    body: "Independent first\n\nInherited continuation",
    segments: (rendition.segments ?? []).map((segment) => ({
      ...segment,
      body: "Independent first\n\nInherited continuation",
      source_overrides: sources,
    })),
  };
  const publication = {
    renditions: [joined],
    segments: ["First canonical", "Inherited continuation", "Omitted canonical"].map(
      (body, index) => ({
        id: `source-${index + 1}`,
        position: index,
        body,
        title: "",
        description: "",
        settings: {},
        media: [],
      }),
    ),
  };
  expect(mobileRenditionTextFields(publication, "founder")).toEqual([
    { key: "source:source-1", value: "Independent first" },
    { key: "source:source-2", value: "Inherited continuation" },
    { key: "source:source-3", value: "" },
  ]);
  const input = mobileRenditionInput(
    publication,
    "founder",
    { "source:source-1": "Revised first" },
    [],
  );
  expect(input.segments?.[0]?.source_overrides).toEqual([
    { ...sources[0], body_override: "Revised first" },
    sources[1],
    sources[2],
  ]);
  expect(input.body).toBe("Revised first\n\nInherited continuation");
});

test("editing a thread continuation preserves the first caption and mirrors its actual text for reopening", () => {
  const thread = {
    ...rendition,
    body: "Stale aggregate caption",
    segments: [
      {
        ...rendition.segments![0]!,
        body: "Independent first",
        body_override: "Independent first",
        source_overrides: undefined,
      },
      {
        ...rendition.segments![0]!,
        id: "variant-2",
        publication_segment_id: "source-2",
        position: 1,
        body: "Second post\n\nGenerated poll: Should we ship?",
        body_override: undefined,
        source_overrides: undefined,
      },
    ],
  };
  const publication = {
    renditions: [thread],
    segments: [
      {
        id: "source-2",
        position: 1,
        body: "Second post",
        title: "",
        description: "",
        settings: {},
        media: [],
      },
    ],
  };
  expect(mobileRenditionTextFields(publication, "founder")).toEqual([
    { key: "segment:0", value: "Independent first" },
    { key: "segment:1", value: "Second post" },
  ]);
  const input = mobileRenditionInput(
    publication,
    "founder",
    { "segment:1": "Edited continuation" },
    [],
  );
  expect(input.body).toBe("Independent first");
  expect(input.segments?.map((segment) => segment.body_override)).toEqual([
    "Independent first",
    "Edited continuation",
  ]);
  expect(input.segments?.[1]?.publication_segment_id).toBe("source-2");
});

test("adding a required demo retains inherited source images inside a joined destination", () => {
  const sourceImage: components["schemas"]["MediaSummary"] = {
    id: "existing-image",
    mime_type: "image/png",
    url: "/media/existing-image",
    original_filename: "proof.png",
    analysis_status: "ready",
    aspect_ratio: "1:1",
    dominant_type: "image",
    duration_ms: 0,
    frame_rate: 0,
    height: 100,
    width: 100,
    size: 100,
    public_url_ready: false,
    public_url_status: 0,
  };
  const joined = {
    ...rendition,
    segments: (rendition.segments ?? []).map((segment) => ({
      ...segment,
      source_overrides: [
        {
          publication_segment_id: "source-1",
          body_override: "Keep this source",
          media_inherited: true,
        },
        { publication_segment_id: "source-2", media_inherited: true },
      ],
    })),
  };
  const input = mobileRenditionInput(
    {
      renditions: [joined],
      segments: [
        {
          id: "source-1",
          position: 0,
          body: "Source",
          title: "",
          description: "",
          settings: {},
          media: [sourceImage],
        },
      ],
    },
    "founder",
    undefined,
    [{ mediaId: "demo", mimeType: "video/mp4" }],
  );
  expect(input.segments?.[0]?.source_overrides?.[0]?.media?.map((item) => item.media_id)).toEqual([
    "existing-image",
    "demo",
  ]);
  expect(input.segments?.[0]?.source_overrides?.[0]?.body_override).toBe("Keep this source");
  expect(input.segments?.[0]?.source_overrides?.[1]?.media_inherited).toBe(true);
});
