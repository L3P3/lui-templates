import {
	NODE_TYPE_ELEMENT,
	VALUE_TYPE_STATIC,
} from '../constants.js';
import {
	html_is_self_closing,
	html_is_whitespace,
	html_attr_to_dom,
	html_whitespaces,
} from '../parser.js';

const TOKEN_HTML_START = 0;
const TOKEN_HTML_END = 1;
const TOKEN_TEXT = 2;

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
		this.chars_step(index_end - this.index);
		return value;
	}

	chars_consume_until_one(limits, desc) {
		let value = '';
		while (this.index < this.src.length) {
			const char = this.char_current();
			if (limits.includes(char)) return value;
			value += char;
			this.char_step();
		}
		error(`Unclosed ${desc}`, this);
	}

	chars_skip_whitespace() {
		while (
			this.index < this.src.length &&
			html_is_whitespace(this.char_current())
		) {
			this.char_step();
		}
	}

	parse_nodes() {
		const tokens = [];

		while (this.index < this.src.length) {
			const char = this.char_current();
			const position = {
				path: this.path,
				line: this.line,
				column: this.column,
			};
			// text nodes
			if (char !== '<') {
				// we do this manually since text can also end at EOF
				const index_lt = this.src.indexOf('<', this.index);
				const value = this.src.slice(
					this.index,
					index_lt > -1
					?	index_lt
					:	this.src.length
				);
				this.chars_step(value.length);
				tokens.push({
					type: TOKEN_TEXT,
					...position,
					value,
				});
			}
			// comment
			else if (this.chars_match('<!--')) {
				this.chars_consume_until('-->', 'comment');
			}
			// end tag
			else if (this.chars_match('</')) {
				this.chars_consume('</');

				const tag_name = this.chars_consume_until('>', 'end tag');
				if (!tag_name) error('empty end tag', position);
				if (tag_name !== tag_name.trim()) error('spaces in end tag', position);

				this.chars_consume('>');

				tokens.push({
					type: TOKEN_HTML_END,
					...position,
					tag_name,
				});
			}
			// start tag
			else {
				tokens.push(
					...this.parse_html_start(position)
				);
			}
		}

		return tokens;
	}

	parse_html_start(position) {
		this.chars_consume('<');
		const tag_name = this.chars_consume_until_one(
			['/', '>', ...html_whitespaces],
			'tag'
		);
		if (!tag_name) error('empty start tag or spaces before tag name', position);

		const props = this.parse_attributes();

		this.chars_skip_whitespace();
		const has_self_closing_slash = this.char_current() === '/';
		if (has_self_closing_slash) {
			this.chars_consume('/');
		}

		this.chars_consume('>');

		const start_token = {
			type: TOKEN_HTML_START,
			...position,
			tag_name,
			props,
		};

		if (
			has_self_closing_slash ||
			html_is_self_closing(tag_name)
		) {
			return [
				start_token,
				{
					type: TOKEN_HTML_END,
					...position,
					tag_name,
				}
			];
		}

		return [start_token];
	}

	parse_attributes() {
		const props = {};

		while (this.index < this.src.length) {
			this.chars_skip_whitespace();

			if (['/', '>'].includes(this.char_current())) return props;

			const name = this.chars_consume_until_one(
				['=', '/', '>', ...html_whitespaces],
				'attribute name'
			);

			if (!name) error('attribute name missing', this);

			this.chars_skip_whitespace();

			let value = true;
			if (this.char_current() === '=') {
				this.chars_consume('=');

				this.chars_skip_whitespace();

				const quote = this.char_current();
				if (quote === '"' || quote === "'") {
					this.chars_consume(quote);
					value = this.chars_consume_until(quote, 'attribute value');
					this.chars_consume(quote);
				}
				else {
					value = this.chars_consume_until_one(
						['/', '>', ...html_whitespaces],
						'attribute value'
					);
				}
			}

			props[html_attr_to_dom(name)] = {
				type: VALUE_TYPE_STATIC,
				data: value,
			};
		}

		error('Unclosed tag', this);
	}
}

function build_nodes(tokens, index, index_end) {
	const nodes = [];
	for (; index < index_end; index++) {
		const token = tokens[index];
		switch (token.type) {
		case TOKEN_HTML_START: {
			const {tag_name, props} = token;
			const index_start = ++index;

			// find matching end tag index
			let depth = 1;
			loop: for (; index < index_end; index++) {
				const token = tokens[index];
				switch (token.type) {
				case TOKEN_HTML_START:
					if (token.tag_name === tag_name) depth++;
					break;
				case TOKEN_HTML_END:
					if (
						token.tag_name === tag_name &&
						--depth === 0
					) {
						break loop;
					}
				}
			}
			if (depth > 0) error(`Unclosed tag <${tag_name}>`, token);

			const children = build_nodes(tokens, index_start, index);

			if (
				children.length > 0 &&
				children[0].is_wrapper
			) {
				props.innerText = children.shift().props.innerText;
			}

			nodes.push({
				is_wrapper: false,
				type: NODE_TYPE_ELEMENT,
				tag: tag_name,
				props,
				children,
			});
			break;
		}
		case TOKEN_HTML_END:
			error(`Unexpected closing tag </${token.tag_name}>`, token);
		case TOKEN_TEXT: {
			let {value} = token;
			if (!value) break;

			const value_trimmed_start = value.trimStart();
			// if first node
			if (nodes.length === 0) {
				if (!value_trimmed_start) break;
				value = value_trimmed_start;
			}
			// if between other nodes and empty
			else if (
				index_end - index > 1 &&
				!value_trimmed_start
			) {
				break;
			}
			// if not first but has leading whitespace
			else if (value !== value_trimmed_start) {
				value = ' ' + value_trimmed_start;
			}

			const value_trimmed_end = value.trimEnd();
			// if last node
			if (index_end - index === 1) {
				if (!value_trimmed_end) break;
				value = value_trimmed_end;
			}
			// if not last but has trailing whitespace
			else if (value !== value_trimmed_end) {
				value = value_trimmed_end + ' ';
			}

			nodes.push({
				is_wrapper: true,
				type: NODE_TYPE_ELEMENT,
				tag: 'span',
				props: {
					innerText: {
						type: VALUE_TYPE_STATIC,
						data: value,
					},
				},
				children: [],
			});
		}
		}
	}
	return nodes;
}
