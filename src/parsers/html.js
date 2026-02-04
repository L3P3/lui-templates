import {
	NODE_TYPE_ELEMENT,
	VALUE_TYPE_STATIC,
} from '../constants.js';
import {
	html_is_self_closing,
	html_is_whitespace,
	html_attr_to_dom,
} from '../parser.js';

const TOKEN_HTML_START = 0;
const TOKEN_HTML_END = 1;
const TOKEN_TEXT = 2;
const TOKEN_ATTRIBUTE = 3;

export default async function parse_html(src, path) {
	const tokenizer = new Tokenizer(src, path);
	const tokens = tokenizer.parse_nodes();
	const nodes = build_nodes(tokens, 0, tokens.length);

	return {
		inputs: [],
		transformations: [],
		effects: [],
		nodes,
	};
}

function error(message, obj) {
	console.error(`Error in ${obj.path}:${obj.line}:${obj.column}: ${message}`);
	process.exit(1);
}

class Tokenizer {
	constructor(src, path) {
		this.src = src;
		this.path = path;
		this.line = 1;
		this.column = 0;
		this.index = 0;
	}

	char_current() {
		return this.src.charAt(this.index);
	}

	chars_match(chars) {
		return this.src.slice(this.index, this.index + chars.length) === chars;
	}

	char_step() {
		const char = this.char_current();
		if (char == null) error('Unexpected end of input', this);
		this.index++;
		if (char === '\n') {
			this.line++;
			this.column = 0;
		}
		else this.column++;
	}

	chars_step(n) {
		for (let i = 0; i < n; i++) {
			this.char_step();
		}
	}

	chars_consume(chars) {
		if (!this.chars_match(chars)) error(`Expected "${chars}"`, this);
		this.chars_step(chars.length);
	}

	chars_consume_until(limit, desc) {
		const index_end = this.src.indexOf(limit, this.index);
		if (index_end === -1) error(`Unclosed ${desc}`, this);
		const value = this.src.slice(this.index, index_end);
		this.chars_step(index_end + limit.length - this.index);
		return value;
	}

	chars_skip_whitespace() {
		while (html_is_whitespace(this.char_current())) {
			this.char_step();
		}
	}

	position_get() {
		return {
			path: this.path,
			line: this.line,
			column: this.column,
		};
	}

	parse_nodes() {
		const tokens = [];

		while (this.index < this.src.length) {
			const char = this.char_current();
			if (html_is_whitespace(char)) {
				this.char_step();
			}
			else if (char === '<') {
				if (this.chars_match('<!--')) this.chars_consume_until('-->', 'HTML comment');
				else if (this.chars_match('</')) {
					const token = this.parse_html_end();
					if (token !== null) tokens.push(token);
				}
				else {
					const result = this.parse_html_start();
					tokens.push(...result);
				}
			}
			else {
				const token = this.parse_text();
				if (token !== null) tokens.push(token);
			}
		}

		return tokens;
	}

	parse_html_start() {
		const position = this.position_get();
		this.chars_consume('<');
		const tag_name = this.parse_tag_name();
		const attributes = this.parse_attributes();
		
		// Check for self-closing slash
		this.chars_skip_whitespace();
		const has_self_closing_slash = this.char_current() === '/';
		if (has_self_closing_slash) {
			this.char_step();
		}
		
		this.chars_consume('>');

		const start_token = {
			type: TOKEN_HTML_START,
			...position,
			tag_name,
			attributes,
		};

		// If it has a self-closing slash and is NOT already a self-closing tag,
		// return both start and end tokens to mark it as self-closing
		if (has_self_closing_slash && !html_is_self_closing(tag_name)) {
			return [start_token, {
				type: TOKEN_HTML_END,
				...position,
				tag_name,
			}];
		}

		return [start_token];
	}

	parse_html_end() {
		const position = this.position_get();
		this.chars_consume('</');
		const tag_name = this.parse_tag_name();
		this.chars_consume('>');

		return {
			type: TOKEN_HTML_END,
			...position,
			tag_name,
		};
	}

	parse_text() {
		const position = this.position_get();
		let value = '';
		while (this.index < this.src.length) {
			const char = this.char_current();
			if (char === '<') break;
			value += char;
			this.char_step();
		}
		return {
			type: TOKEN_TEXT,
			...position,
			value,
		};
	}

	parse_tag_name() {
		let name = '';
		while (this.index < this.src.length) {
			const char = this.char_current();
			if (html_is_whitespace(char) || char === '>' || char === '/') break;
			name += char;
			this.char_step();
		}
		return name;
	}

	parse_attributes() {
		const attributes = {};

		while (this.index < this.src.length) {
			while (html_is_whitespace(this.char_current())) {
				this.char_step();
			}

			const char = this.char_current();
			if (char === '>' || char === '/') break;

			let name = '';
			while (this.index < this.src.length) {
				const c = this.char_current();
				if (html_is_whitespace(c) || c === '=' || c === '>' || c === '/') break;
				name += c;
				this.char_step();
			}

			if (!name) break;

			while (html_is_whitespace(this.char_current())) {
				this.char_step();
			}

			let value = null;
			if (this.char_current() === '=') {
				this.char_step();

				while (html_is_whitespace(this.char_current())) {
					this.char_step();
				}

				const quote = this.char_current();
				if (quote === '"' || quote === "'") {
					this.char_step();
					let text = '';
					while (this.index < this.src.length) {
						const c = this.char_current();
						if (c === quote) break;
						text += c;
						this.char_step();
					}
					this.chars_consume(quote);
					value = text;
				}
				else {
					let text = '';
					while (this.index < this.src.length) {
						const c = this.char_current();
						if (html_is_whitespace(c) || c === '>' || c === '/') break;
						text += c;
						this.char_step();
					}
					value = text;
				}
			}

			attributes[html_attr_to_dom(name)] = value;
		}

		return attributes;
	}
}

function build_nodes(tokens, index, index_end) {
	const nodes = [];
	
	// Check if we have mixed content (both text and elements)
	let has_text = false;
	let has_elements = false;
	for (let i = index; i < index_end; i++) {
		if (tokens[i].type === TOKEN_TEXT && tokens[i].value.trim()) {
			has_text = true;
		} else if (tokens[i].type === TOKEN_HTML_START) {
			has_elements = true;
		}
	}
	const is_mixed_content = has_text && has_elements;

	while (index < index_end) {
		const token = tokens[index];

		switch (token.type) {
		case TOKEN_HTML_START: {
			const node = build_element_node(tokens, index);
			nodes.push(node.element);
			index = node.index;
			continue;
		}
		case TOKEN_HTML_END:
			error(`Unexpected closing tag </${token.tag_name}>`, token);
		case TOKEN_TEXT: {
			const merge_list = [];
			for (; index < index_end; index++) {
				const token = tokens[index];
				if (token.type !== TOKEN_TEXT) break;
				merge_list.push(token);
			}

			const innerText = build_text_value(merge_list, is_mixed_content, nodes.length === 0, index >= index_end);
			if (innerText) {
				nodes.push({
					type: NODE_TYPE_ELEMENT,
					tag: 'span',
					props: {
						innerText,
					},
					children: [],
				});
			}
			continue;
		}
		}

		index++;
	}

	return nodes;
}

function build_element_node(tokens, index) {
	const token_start = tokens[index++];

	const props = {};
	if (token_start.attributes) {
		for (const [name, value] of Object.entries(token_start.attributes)) {
			props[name] = (
				value === null
				?	{type: VALUE_TYPE_STATIC, data: true}
				:	{type: VALUE_TYPE_STATIC, data: value}
			);
		}
	}

	let children = [];
	if (!html_is_self_closing(token_start.tag_name)) {
		const index_start = index;
		({children, index} = build_children(tokens, index, token_start.tag_name));

		if (children.length === 0) {
			const merge_list = [];
			loop: for (let i = index_start; i < tokens.length; i++) {
				const token = tokens[i];

				switch (token.type) {
				case TOKEN_HTML_END:
					if (token.tag_name === token_start.tag_name) break loop;
				case TOKEN_HTML_START:
					break loop;
				}

				merge_list.push(token);
			}

			const value = build_value_trimmed(merge_list);
			if (value) props.innerText = value;
		}
	}

	return {
		element: {
			type: NODE_TYPE_ELEMENT,
			tag: token_start.tag_name,
			props,
			children,
		},
		index,
	};
}

function build_children(tokens, index, tag_parent) {
	const content = [];

	let depth = 1;
	loop: for (; index < tokens.length; index++) {
		const token = tokens[index];

		switch (token.type) {
			case TOKEN_HTML_START:
				if (token.tag_name === tag_parent) depth++;
				break;
			case TOKEN_HTML_END:
				if (
					token.tag_name === tag_parent &&
					--depth === 0
				) {
					index++;
					break loop;
				}
		}

		content.push(token);
	}

	if (depth > 0) {
		error(`Unclosed tag <${tag_parent}>`, tokens[index - 1] || tokens[0]);
	}

	// Check if content is text-only (no HTML elements)
	const has_elements = content.some(t => t.type === TOKEN_HTML_START);
	
	return {
		children: has_elements ? build_nodes(content, 0, content.length) : [],
		index,
	};
}

function build_value(tokens) {
	const values = tokens.map(token => ({
		type: VALUE_TYPE_STATIC,
		data: token.value,
	}));
	
	return (
		values.length === 1
		?	values[0]
		:	{
			type: VALUE_TYPE_STATIC,
			data: values.map(v => v.data).join(''),
		}
	);
}

function build_text_value(tokens, is_mixed_content, is_first, is_last) {
	const filtered = [];

	let empty = true;
	for (const token of tokens) {
		if (token.type === TOKEN_TEXT) {
			filtered.push({...token});
			if (token.value.trim()) {
				empty = false;
			}
		}
	}
	
	if (empty) {
		return null;
	}

	// Trim start if it's the first node or not mixed content
	if (filtered.length > 0 && filtered[0].type === TOKEN_TEXT && (!is_mixed_content || is_first)) {
		const trimmed = filtered[0].value.trimStart();
		if (trimmed) filtered[0].value = trimmed;
		else {
			filtered.shift();
			if (filtered.length === 0) return null;
		}
	}
	
	// Trim end if it's the last node or not mixed content
	if (filtered.length > 0 && (!is_mixed_content || is_last)) {
		const last = filtered[filtered.length - 1];
		if (last.type === TOKEN_TEXT) {
			const trimmed = last.value.trimEnd();
			if (trimmed) last.value = trimmed;
			else {
				filtered.pop();
				if (filtered.length === 0) return null;
			}
		}
	}

	return build_value(filtered);
}

function build_value_trimmed(tokens) {
	const filtered = [];

	let empty = true;
	for (const token of tokens) {
		if (token.type === TOKEN_TEXT) {
			filtered.push({...token});
			if (token.value.trim()) {
				empty = false;
			}
		}
	}
	
	if (empty) {
		return null;
	}

	if (filtered.length > 0 && filtered[0].type === TOKEN_TEXT) {
		const trimmed = filtered[0].value.trimStart();
		if (trimmed) filtered[0].value = trimmed;
		else {
			filtered.shift();
			if (filtered.length === 0) return null;
		}
	}
	
	if (filtered.length > 0) {
		const last = filtered[filtered.length - 1];
		if (last.type === TOKEN_TEXT) {
			const trimmed = last.value.trimEnd();
			if (trimmed) last.value = trimmed;
			else {
				filtered.pop();
				if (filtered.length === 0) return null;
			}
		}
	}

	return build_value(filtered);
}
