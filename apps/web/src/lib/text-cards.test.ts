import { createPreviewModel } from '@openpost/social-preview';
import { expect, it } from 'vitest';
import { textCardRequest, textCardRequestKey, withTextCardImages } from './text-cards';

it('joins a card and unique attachments in source order, retaining the first alt text', () => {
	const model = createPreviewModel({
		platform: 'instagram',
		identity: { displayName: 'Founder', handle: 'founder' },
		segments: [
			{
				id: 'a',
				text: 'First',
				media: [{ id: 'photo', kind: 'image', src: '/first.jpg', alt: 'First description' }]
			},
			{
				id: 'b',
				text: 'Second',
				media: [
					{ id: 'photo', kind: 'image', src: '/second.jpg', alt: 'Later description' },
					{ id: 'clip', kind: 'video', src: '/clip.mp4' }
				]
			}
		]
	});
	const request = textCardRequest('account', model, { text_card: 'always' }, 'instagram.carousel');
	expect(request).toMatchObject({ text: 'First\n\nSecond', attachment_count: 2 });
	const preview = withTextCardImages(model, [
		{ data_url: '/saved-card.jpg', width: 1080, height: 1350 }
	]);
	expect(preview.segments).toHaveLength(1);
	expect(preview.media.map((media) => media.src)).toEqual([
		'/saved-card.jpg',
		'/first.jpg',
		'/clip.mp4'
	]);
	expect(preview.media[1].alt).toBe('First description');
});

it('reuses the same saved image across automatic format resolution and explicit default styling', () => {
	const request = {
		social_account_id: 'account',
		text: 'A saved post',
		attachment_count: 0,
		settings: { text_card: 'text_only' }
	};
	expect(textCardRequestKey(request)).toBe(
		textCardRequestKey({
			...request,
			output_profile: 'instagram.feed',
			settings: { ...request.settings, text_card_appearance: 'light' }
		})
	);
	expect(textCardRequestKey(request)).not.toBe(
		textCardRequestKey({ ...request, output_profile: 'instagram.story' })
	);
	expect(textCardRequestKey(request)).not.toBe(textCardRequestKey({ ...request, text: 'Changed' }));
	expect(textCardRequestKey(request)).not.toBe(
		textCardRequestKey({ ...request, attachment_count: 1 })
	);
});
