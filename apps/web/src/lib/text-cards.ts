import type { components } from '$lib/api/types';
import type { ComposerSettings } from '$lib/components/compose/modes';
import type { PreviewModel } from '@openpost/social-preview';

export type TextCardRequest = components['schemas']['PreviewTextCardInputBody'];
export type TextCardImage = components['schemas']['TextCardPreviewImage'];
export interface TextCardResult {
	key: string;
	images: TextCardImage[];
	loading: boolean;
	error: string;
}

export function supportsTextCards(provider: string, output = ''): boolean {
	return provider === 'instagram'
		? ['', 'instagram.feed', 'instagram.carousel', 'instagram.story'].includes(output)
		: provider === 'pixelfed' && ['', 'pixelfed.post', 'pixelfed.carousel'].includes(output);
}

export function textCardSettings(settings: ComposerSettings): ComposerSettings {
	return Object.fromEntries(
		Object.entries(settings).filter(([key]) => key === 'text_card' || key.startsWith('text_card_'))
	);
}

export function textCardRequest(
	accountId: string,
	model: PreviewModel,
	settings: ComposerSettings,
	outputProfile: string
): TextCardRequest | null {
	const text = model.segments
		.map((segment) => segment.text.trim())
		.filter(Boolean)
		.join('\n\n');
	const attachments =
		new Set(model.segments.flatMap((segment) => (segment.media ?? []).map((media) => media.id)))
			.size || model.media.length;
	if (!supportsTextCards(model.platform, outputProfile) || !text.trim()) return null;
	if (settings.text_card !== 'always' && !(settings.text_card === 'text_only' && attachments === 0))
		return null;
	return {
		social_account_id: accountId,
		text,
		output_profile: outputProfile,
		attachment_count: attachments,
		settings: textCardSettings(settings)
	};
}

export function withTextCardImages(model: PreviewModel, images: TextCardImage[]): PreviewModel {
	if (!images.length) return model;
	const text = model.segments
		.map((segment) => segment.text.trim())
		.filter(Boolean)
		.join('\n\n');
	const cards = images.map((image, index) => ({
		id: `text-card:${index}`,
		kind: 'image' as const,
		src: image.data_url,
		alt: text,
		aspectRatio: image.width / image.height
	}));
	const attachments = new Map<string, PreviewModel['media'][number]>();
	for (const media of [
		...model.segments.flatMap((segment) => segment.media ?? []),
		...model.media
	]) {
		if (!attachments.has(media.id)) attachments.set(media.id, media);
	}
	const media = [...cards, ...attachments.values()];
	return { ...model, media, segments: [{ ...model.segments[0], text, media }] };
}

export function textCardRequestKey(request: TextCardRequest | null): string {
	if (!request) return '';
	const settings = request.settings ?? {};
	return JSON.stringify([
		request.social_account_id,
		request.text.trim(),
		request.output_profile === 'instagram.story',
		request.attachment_count ?? 0,
		settings.text_card_appearance ?? 'light',
		settings.text_card_background ?? 'gradient',
		settings.text_card_color ?? '#c4b5fd',
		settings.text_card_color_end ?? '#93c5fd',
		settings.text_card_rounded ?? true,
		settings.text_card_shadow ?? true
	]);
}

export function savedTextCardPreviews(
	renditions: components['schemas']['RenditionResponse'][] = []
) {
	const previews: Record<string, TextCardResult> = {};
	for (const rendition of renditions) {
		const segments = rendition.segments ?? [];
		const cards = segments
			.flatMap((segment) => segment.output_media ?? [])
			.filter((media) => media.role === 'text_card');
		if (!cards.length) continue;
		const request: TextCardRequest = {
			social_account_id: rendition.social_account_id,
			text: segments
				.map((segment) => segment.body.trim())
				.filter(Boolean)
				.join('\n\n'),
			output_profile: rendition.output_profile,
			attachment_count: new Set(
				segments.flatMap((segment) => (segment.media ?? []).map((media) => media.id))
			).size,
			settings: rendition.settings ?? {}
		};
		previews[rendition.social_account_id] = {
			key: textCardRequestKey(request),
			images: cards.map((media) => ({
				data_url: media.url,
				width: media.width,
				height: media.height
			})),
			loading: false,
			error: ''
		};
	}
	return previews;
}
