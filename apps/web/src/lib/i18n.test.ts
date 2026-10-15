import { describe, expect, it } from 'vitest';
import { getLocaleTag } from './i18n';

describe('locale formatting', () => {
	it('uses Italian conventions for numbers and dates', () => {
		const locale = getLocaleTag('it');

		expect(new Intl.NumberFormat(locale).format(12345.6)).toBe('12.345,6');
		expect(
			new Intl.DateTimeFormat(locale, {
				day: 'numeric',
				month: 'long',
				year: 'numeric',
				timeZone: 'UTC'
			}).format(new Date('2026-10-14T12:00:00Z'))
		).toBe('14 ottobre 2026');
	});
});
