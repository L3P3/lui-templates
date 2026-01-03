import {
	NODE_TYPE_ELEMENT,
	VALUE_TYPE_FIELD,
	VALUE_TYPE_STATIC,
	VALUE_TYPE_STRING_CONCAT,
} from '../constants.js';

export default async function parseLiquid(src, path) {
	const inputs = new Set();
	const nodes = parseNodes(src.trim(), inputs);
	
	return {
		inputs: Array.from(inputs).map(name => ({ name })),
		transformations: [],
		effects: [],
		nodes,
	};
}

/**
 * Parse HTML nodes from a string
 */
function parseNodes(html, inputs) {
	const nodes = [];
	let pos = 0;
	
	while (pos < html.length) {
		// Skip whitespace
		const wsMatch = html.slice(pos).match(/^[\s\n]+/);
		if (wsMatch) {
			pos += wsMatch[0].length;
			if (pos >= html.length) break;
		}
		
		// Check for opening tag
		if (html[pos] === '<' && html[pos + 1] !== '/') {
			const result = parseElement(html, pos, inputs);
			if (result) {
				nodes.push(result.node);
				pos = result.pos;
				continue;
			}
		}
		
		// If we have text that's not inside a tag, skip it
		// (standalone text should be inside elements)
		const nextTag = html.indexOf('<', pos);
		if (nextTag === -1) break;
		pos = nextTag;
	}
	
	return nodes;
}

/**
 * Parse a single HTML element
 */
function parseElement(html, pos, inputs) {
	// Match opening tag: <tagname attr="value" ...>
	const tagMatch = html.slice(pos).match(/^<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^>]*)?)>/);
	if (!tagMatch) return null;
	
	const tag = tagMatch[1];
	const attrsString = tagMatch[2];
	const tagEndPos = pos + tagMatch[0].length;
	
	// Parse attributes (supports both double and single quotes)
	const props = {};
	if (attrsString.trim()) {
		// Match attributes with double quotes or single quotes
		const attrRegex = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*["']([^"']*)["']/g;
		let attrMatch;
		while ((attrMatch = attrRegex.exec(attrsString)) !== null) {
			const attrName = attrMatch[1];
			const attrValue = attrMatch[2];
			props[attrName] = parseValue(attrValue, inputs);
		}
	}
	
	// Check for self-closing tags
	const isSelfClosing = ['img', 'br', 'hr', 'input', 'meta', 'link'].includes(tag);
	
	// Parse children
	const children = [];
	let contentEnd = tagEndPos;
	
	if (!isSelfClosing) {
		// Simple approach: find the closing tag by counting depth
		const closingTag = `</${tag}>`;
		let depth = 1;
		let i = tagEndPos;
		
		while (i < html.length && depth > 0) {
			// Check for closing tag
			if (html.slice(i).startsWith(closingTag)) {
				depth--;
				if (depth === 0) {
					contentEnd = i;
					break;
				}
				i += closingTag.length;
				continue;
			}
			
			// Check for nested opening tag
			const openMatch = html.slice(i).match(/^<([a-zA-Z][a-zA-Z0-9-]*)/);
			if (openMatch && openMatch[1] === tag) {
				depth++;
			}
			
			i++;
		}
		
		// Parse content between opening and closing tags
		const content = html.slice(tagEndPos, contentEnd);
		if (content.trim()) {
			parseContent(content, children, inputs, props);
		}
		
		// Move position past closing tag
		contentEnd += closingTag.length;
	}
	
	return {
		node: {
			type: NODE_TYPE_ELEMENT,
			tag,
			props,
			children,
		},
		pos: contentEnd,
	};
}

/**
 * Parse content (text and child elements) within an element
 */
function parseContent(content, children, inputs, props) {
	content = content.trim();
	
	// Check if content contains HTML tags
	const hasHtmlTags = /<[a-zA-Z]/.test(content);
	
	if (!hasHtmlTags) {
		// Pure text content - set as innerText property
		const textValue = parseValue(content, inputs);
		if (textValue) {
			props.innerText = textValue;
		}
		return;
	}
	
	// Mixed content - parse child elements
	let pos = 0;
	while (pos < content.length) {
		// Skip whitespace
		const wsMatch = content.slice(pos).match(/^[\s\n]+/);
		if (wsMatch) {
			pos += wsMatch[0].length;
			if (pos >= content.length) break;
		}
		
		// Check for element
		if (content[pos] === '<' && content[pos + 1] !== '/') {
			const result = parseElement(content, pos, inputs);
			if (result) {
				children.push(result.node);
				pos = result.pos;
				continue;
			}
		}
		
		// Move past any unrecognized content
		const nextTag = content.indexOf('<', pos + 1);
		if (nextTag === -1) break;
		pos = nextTag;
	}
}

/**
 * Parse a value that might contain Liquid variables
 */
function parseValue(str, inputs) {
	// Find all Liquid variable references {{ variable }}
	const parts = [];
	let lastIndex = 0;
	const regex = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
	let match;
	
	while ((match = regex.exec(str)) !== null) {
		// Add static text before the variable
		if (match.index > lastIndex) {
			parts.push({
				type: VALUE_TYPE_STATIC,
				data: str.slice(lastIndex, match.index),
			});
		}
		
		// Add the variable reference
		const varName = match[1];
		inputs.add(varName);
		parts.push({
			type: VALUE_TYPE_FIELD,
			data: varName,
		});
		
		lastIndex = match.index + match[0].length;
	}
	
	// Add remaining static text
	if (lastIndex < str.length) {
		parts.push({
			type: VALUE_TYPE_STATIC,
			data: str.slice(lastIndex),
		});
	}
	
	// Return appropriate value type
	if (parts.length === 0) {
		return { type: VALUE_TYPE_STATIC, data: '' };
	} else if (parts.length === 1) {
		return parts[0];
	} else {
		return { type: VALUE_TYPE_STRING_CONCAT, data: parts };
	}
}
