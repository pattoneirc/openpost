import type { components } from "@openpost/api-contract";

type Publication = components["schemas"]["PublicationResponse"];
type Rendition = components["schemas"]["RenditionResponse"];
type RenditionSegment = components["schemas"]["RenditionSegmentResponse"];
type Media = components["schemas"]["MediaSummary"];
type MediaInput = components["schemas"]["PublicationMediaInput"];
type Attachment = { mediaId?: string; mimeType: string };
type PublicationContent = Pick<Publication, "renditions" | "segments">;
export type RenditionTextEdits = Readonly<Record<string, string>>;

function authoredSegmentBody(
  publication: PublicationContent,
  rendition: Rendition,
  segment: RenditionSegment,
) {
  if (segment.body_override !== undefined) return segment.body_override;
  if (rendition.segments?.length === 1 && (publication.segments?.length ?? 0) > 1) {
    return publication
      .segments!.map((source) => source.body.trim())
      .filter(Boolean)
      .join("\n\n");
  }
  return (
    publication.segments?.find((source) => source.id === segment.publication_segment_id)?.body ??
    segment.body
  );
}

/** Joined captions edit canonical sources; thread captions edit ordered output segments. */
export function mobileRenditionTextFields(publication: PublicationContent, accountId: string) {
  const rendition = publication.renditions?.find((item) => item.social_account_id === accountId);
  const joined = rendition?.segments?.find((segment) => segment.source_overrides?.length);
  if (joined) {
    return (publication.segments ?? []).map((source) => ({
      key: `source:${source.id}`,
      value:
        joined.source_overrides?.find((override) => override.publication_segment_id === source.id)
          ?.body_override ?? source.body,
    }));
  }
  if (rendition?.segments?.length) {
    return rendition.segments.map((segment) => ({
      key: `segment:${segment.position}`,
      value: authoredSegmentBody(publication, rendition, segment),
    }));
  }
  return [{ key: "body", value: rendition?.body ?? publication.segments?.[0]?.body ?? "" }];
}

function withAttachments(
  media: readonly MediaInput[],
  attachments: readonly Attachment[],
): MediaInput[] {
  const result = [...media];
  for (const attachment of attachments) {
    if (attachment.mediaId && !result.some((item) => item.media_id === attachment.mediaId))
      result.push({ media_id: attachment.mediaId });
  }
  return result;
}

function mediaInput(media: Media): MediaInput {
  return {
    media_id: media.id,
    role: media.role,
    alt_text: media.alt_text,
    thumbnail_timestamp_ms: media.thumbnail_timestamp_ms,
    settings: media.settings,
  };
}

export function attachmentRequirement(
  settings: Record<string, unknown>,
): { kind: "image" | "video"; brief: string } | undefined {
  const value = settings.attachment_requirement;
  if (
    !value ||
    typeof value !== "object" ||
    !("kind" in value) ||
    (value.kind !== "image" && value.kind !== "video")
  )
    return;
  return {
    kind: value.kind,
    brief: "brief" in value && typeof value.brief === "string" ? value.brief : "",
  };
}

/** Preserve authored destination media, formats, and segment settings on native saves. */
export function mobileRenditionInput(
  publication: PublicationContent,
  accountId: string,
  textEdits: RenditionTextEdits | undefined,
  attachments: readonly Attachment[],
): components["schemas"]["RenditionInput"] {
  const rendition = publication.renditions?.find((item) => item.social_account_id === accountId);
  if (!rendition)
    return {
      social_account_id: accountId,
      ...(textEdits?.body === undefined ? {} : { body: textEdits.body }),
    };
  const segments = rendition.segments?.map((segment) => {
    const requirement = attachmentRequirement(segment.settings);
    const supplied = requirement
      ? attachments.filter(
          (attachment) =>
            attachment.mediaId && attachment.mimeType.startsWith(`${requirement.kind}/`),
        )
      : [];
    const media = withAttachments((segment.media ?? []).map(mediaInput), supplied);
    let body = textEdits?.[`segment:${segment.position}`] ?? segment.body_override;
    let sources = segment.source_overrides;
    if (sources?.length) {
      sources = sources.map((source) => ({ ...source }));
      for (const canonical of publication.segments ?? []) {
        const caption = textEdits?.[`source:${canonical.id}`];
        const addsMedia = supplied.length > 0 && canonical.id === publication.segments?.[0]?.id;
        if (caption === undefined && !addsMedia) continue;
        let source = sources.find((item) => item.publication_segment_id === canonical.id);
        if (!source) {
          source = { publication_segment_id: canonical.id, media_inherited: true };
          sources.push(source);
        }
        if (caption !== undefined) source.body_override = caption;
        if (addsMedia) {
          const sourceMedia = source.media_inherited
            ? (canonical.media ?? []).map(mediaInput)
            : (source.media ?? []);
          source.media = withAttachments(sourceMedia, supplied);
          source.media_inherited = false;
        }
      }
      if (publication.segments?.length) {
        body = publication.segments
          .map((canonical) =>
            (
              sources?.find((source) => source.publication_segment_id === canonical.id)
                ?.body_override ?? canonical.body
            ).trim(),
          )
          .filter(Boolean)
          .join("\n\n");
      }
    }
    return {
      publication_segment_id: segment.publication_segment_id,
      body_override: body,
      title_override: segment.title_override,
      description_override: segment.description_override,
      url_override: segment.url_override,
      settings: segment.settings,
      media_inherited: supplied.length ? false : segment.media_inherited,
      ...(supplied.length || !segment.media_inherited ? { media } : {}),
      ...(sources?.length ? { source_overrides: sources } : {}),
    };
  });
  return {
    social_account_id: accountId,
    target_key: rendition.target_key,
    output_profile: rendition.output_profile,
    format_locked: rendition.format_locked,
    profile: rendition.profile,
    title: rendition.title,
    description: rendition.description,
    settings: rendition.settings,
    schedule_override: rendition.schedule_override,
    ...(segments?.length
      ? {
          body:
            segments[0].body_override ??
            authoredSegmentBody(publication, rendition, rendition.segments![0]!),
          segments,
        }
      : {
          body: textEdits?.body ?? rendition.body,
          media: (rendition.media ?? []).map(mediaInput),
        }),
  };
}

export function renditionImages(rendition: Rendition): Media[] {
  const media =
    rendition.segments?.flatMap((segment) => segment.media ?? []) ?? rendition.media ?? [];
  return [
    ...new Map(
      media.filter((item) => item.mime_type.startsWith("image/")).map((item) => [item.id, item]),
    ).values(),
  ];
}
