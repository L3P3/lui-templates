import fs from 'fs/promises';

import {name_format} from './generator.js';

const parsers = new Map();

export async function parse(path) {
	const src_promise = fs.readFile(path, 'utf8');

	let name = path.split('/').pop().split('.');
	const extension = name.pop();
	name = name.join('.');

	let parser = parsers.get(extension);
	if (!parser) {
		try {
			parser = (await import(`./parsers/${extension}.js`)).default;
		} catch (e) {
			throw new Error(`No parser found for extension: ${extension}`);
		}

		parsers.set(extension, parser);
	}

	return [
		name_format(name),
		await parser(await src_promise, path),
	];
}

const html_attr_to_dom_map = new Map([
	['class', 'className'],
	['for', 'htmlFor'],
	['tabindex', 'tabIndex'],
	['readonly', 'readOnly'],
	['maxlength', 'maxLength'],
	['cellspacing', 'cellSpacing'],
	['cellpadding', 'cellPadding'],
	['rowspan', 'rowSpan'],
	['colspan', 'colSpan'],
	['usemap', 'useMap'],
	['frameborder', 'frameBorder'],
	['contenteditable', 'contentEditable'],
]);
export function html_attr_to_dom(attr) {
	attr = attr.toLowerCase();
	return html_attr_to_dom_map.get(attr) || attr;
}

export const html_whitespaces = ' \n\r\t\f\v'.split('');
export const html_is_whitespace = char => html_whitespaces.includes(char);

const html_self_closing = 'img,input,br,hr'.split(',');
export const html_is_self_closing = tag => html_self_closing.includes(tag);

const html_boolean_attrs = new Set('disabled,checked,selected,readonly,required,autofocus,autoplay,controls,loop,muted,open,hidden,multiple,defer,async,novalidate,formnovalidate'.split(','));
export const html_is_boolean_attr = attr => html_boolean_attrs.has(attr.toLowerCase());

// Map of HTML entities to their corresponding characters
const html_entity_map = new Map([
	// Common punctuation and symbols
	['lt', '<'],
	['gt', '>'],
	['amp', '&'],
	['quot', '"'],
	['apos', "'"],
	// Common Latin characters with diacritics
	['auml', 'ä'],
	['Auml', 'Ä'],
	['ouml', 'ö'],
	['Ouml', 'Ö'],
	['uuml', 'ü'],
	['Uuml', 'Ü'],
	['szlig', 'ß'],
	['euml', 'ë'],
	['Euml', 'Ë'],
	['iuml', 'ï'],
	['Iuml', 'Ï'],
	['yuml', 'ÿ'],
	['Yuml', 'Ÿ'],
	['aacute', 'á'],
	['Aacute', 'Á'],
	['eacute', 'é'],
	['Eacute', 'É'],
	['iacute', 'í'],
	['Iacute', 'Í'],
	['oacute', 'ó'],
	['Oacute', 'Ó'],
	['uacute', 'ú'],
	['Uacute', 'Ú'],
	['yacute', 'ý'],
	['Yacute', 'Ý'],
	['agrave', 'à'],
	['Agrave', 'À'],
	['egrave', 'è'],
	['Egrave', 'È'],
	['igrave', 'ì'],
	['Igrave', 'Ì'],
	['ograve', 'ò'],
	['Ograve', 'Ò'],
	['ugrave', 'ù'],
	['Ugrave', 'Ù'],
	['acirc', 'â'],
	['Acirc', 'Â'],
	['ecirc', 'ê'],
	['Ecirc', 'Ê'],
	['icirc', 'î'],
	['Icirc', 'Î'],
	['ocirc', 'ô'],
	['Ocirc', 'Ô'],
	['ucirc', 'û'],
	['Ucirc', 'Û'],
	['atilde', 'ã'],
	['Atilde', 'Ã'],
	['ntilde', 'ñ'],
	['Ntilde', 'Ñ'],
	['otilde', 'õ'],
	['Otilde', 'Õ'],
	['aring', 'å'],
	['Aring', 'Å'],
	['ccedil', 'ç'],
	['Ccedil', 'Ç'],
	['aelig', 'æ'],
	['AElig', 'Æ'],
	['oslash', 'ø'],
	['Oslash', 'Ø'],
	['eth', 'ð'],
	['ETH', 'Ð'],
	['thorn', 'þ'],
	['THORN', 'Þ'],
	// Common symbols and special characters
	['nbsp', '\u00A0'],
	['copy', '©'],
	['reg', '®'],
	['trade', '™'],
	['euro', '€'],
	['cent', '¢'],
	['pound', '£'],
	['yen', '¥'],
	['sect', '§'],
	['para', '¶'],
	['deg', '°'],
	['plusmn', '±'],
	['micro', 'µ'],
	['middot', '·'],
	['bull', '•'],
	['hellip', '…'],
	['prime', '′'],
	['Prime', '″'],
	['lsquo', '\u2018'],
	['rsquo', '\u2019'],
	['ldquo', '\u201C'],
	['rdquo', '\u201D'],
	['sbquo', '\u201A'],
	['bdquo', '\u201E'],
	['dagger', '†'],
	['Dagger', '‡'],
	['permil', '‰'],
	['lsaquo', '‹'],
	['rsaquo', '›'],
	['ndash', '\u2013'],
	['mdash', '\u2014'],
	['minus', '−'],
	['times', '×'],
	['divide', '÷'],
	['frac14', '¼'],
	['frac12', '½'],
	['frac34', '¾'],
]);

/**
 * Unescapes HTML entities in a string
 * Supports named entities (e.g., &lt;, &amp;, &auml;) and numeric entities (e.g., &#60;, &#x3C;)
 * @param {string} str - The HTML string to unescape
 * @returns {string} The unescaped string
 */
export function html_unescape(str) {
	const isValidCodePoint = (codePoint) => 
		!isNaN(codePoint) && codePoint >= 0 && codePoint <= 0x10FFFF;

	return str.replace(/&([a-zA-Z][a-zA-Z0-9]*|#[0-9]+|#[xX][0-9a-fA-F]+);/g, (match, entity) => {
		// Handle numeric entities (hexadecimal)
		if (entity.startsWith('#x') || entity.startsWith('#X')) {
			const codePoint = parseInt(entity.slice(2), 16);
			if (!isValidCodePoint(codePoint)) return match;
			return String.fromCodePoint(codePoint);
		}
		// Handle numeric entities (decimal)
		if (entity.startsWith('#')) {
			const codePoint = parseInt(entity.slice(1), 10);
			if (!isValidCodePoint(codePoint)) return match;
			return String.fromCodePoint(codePoint);
		}
		// Handle named entities
		return html_entity_map.get(entity) || match;
	});
}
