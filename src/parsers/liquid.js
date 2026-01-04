import { type } from 'os';
import {
	NODE_TYPE_ELEMENT,
	VALUE_TYPE_FIELD,
	VALUE_TYPE_STATIC,
	VALUE_TYPE_STRING_CONCAT,
} from '../constants.js';
import {
	html_attr_to_dom,
	html_is_self_closing,
	html_is_whitespace,
} from '../parser.js';

const TOKEN_HTML_START = 0; // html start tag
const TOKEN_HTML_END = 1; // html end tag
const TOKEN_TEXT = 2; // static text
const TOKEN_ATTRIBUTE = 3; // html attribute
const TOKEN_EXPRESSION = 4; // (inline transformed) variable
const TOKEN_CONDITIONAL = 5; // if/unless node
const TOKEN_LOOP = 6; // for node
const TOKEN_SCRIPT = 7; // liquid script node

export default async function parse_liquid(src, path) {
	const tokenizer = new Tokenizer(src, path);
	const tokens = tokenizer.parse_nodes();
	const nodes = nodes_from_tokens(tokens);

	return {
		inputs: (
			Array.from(tokenizer.variables)
			// variables that are not assigned anywhere
			.filter(([, value]) => value === null)
			.map(([name]) => ({ name }))
		),
		// what variables are derived from other variables via transformations?
		transformations: [],// TODO
		// not used for now
		effects: [],
		nodes,
	};
}

/**
	To parse liquid, we first need to "tokenize" the input string into meaningful chunks.
	Reason for this is that we can have computed values, if and unless at almost any place.
	Our internal tree should consist of html start tags, html end tags, static text, html attributes, (inline transformed) variables, if nodes, loop nodes, and other liquid nodes.
	Then, we can traverse this tree to optimize it and generate the final output.
	Certain html elements are forbidden: script, style, link, noscript, etc.
	For clarity, no RegExp are used in this file and stuff related to html spec belongs to parser.js.
*/

class Tokenizer {
	constructor(src, path) {
		this.src = src;
		this.path = path;
		this.index = 0;
		this.line = 1;
		this.column = 0;
		this.nodes = [];
		this.variables = new Map;
	}

	/**
		Returns the current character being processed.
	*/
	char_current() {
		return this.src.charAt(this.index);
	}

	/**
		Checks if the next characters match the given string.
		@param {string} chars
		@returns {boolean}
	*/
	chars_match(chars) {
		return this.src.slice(this.index, this.index + chars.length) === chars;
	}

	/**
		Steps to the next character.
	*/
	char_step() {
		const char = this.char_current();
		if (char == null) this.error('Unexpected end of input');
		this.index++;
		if (char === '\n') {
			this.line++;
			this.column = 0;
		}
		else this.column++;
	}

	/**
		Steps over n characters.
		@param {number} n
	*/
	chars_step(n) {
		for (let i = 0; i < n; i++) {
			this.char_step();
		}
	}

	/**
		Consumes the given characters from the input.
		@param {string} chars
	*/
	chars_consume(chars) {
		if (!this.chars_match(chars)) this.error(`Expected "${chars}"`);
		this.chars_step(chars.length);
	}

	/**
		Consumes characters until the given limit is reached.
		@param {string} limit - The end delimiter
		@param {string} desc - Description of the context
	*/
	chars_consume_until(limit, desc) {
		const index_end = this.src.indexOf(limit, this.index);
		if (index_end === -1) this.error(`Unclosed ${desc}`);
		this.chars_step(index_end + limit.length - this.index);
		return this.src.slice(this.index, index_end);
	}

	/**
		Handles errors during tokenization.
		@param {string} message
	*/
	error(message) {
		console.error(`Syntax error in ${this.path}:${this.line}:${this.column}: ${message}`);
		process.exit(1);
	}

	/**
		Expects to be in either top level or inside a block.
		@returns {Array} Array of Tokens
	*/
	parse_nodes() {
		const tokens = [];

		while (this.index < this.src.length) {
			let token = null;

			const char = this.char_current();
			if (html_is_whitespace(char)) {
				this.char_step();
			}
			else if (char === '<') {
				if (this.chars_match('<!--')) this.chars_consume_until('-->', 'HTML comment');
				else if (this.chars_match('</')) token = this.parse_html_end();
				else token = this.parse_html_start();
			}
			else if (char === '{') {
				token = this.parse_liquid(false);
			}
			else {
				token = this.parse_text();
			}

			if (token !== null) tokens.push(token);
		}

		return tokens;
	}

	/**
		Parses a html start tag, including (dynamic) tag name and attributes.
		@returns {Object} Token
	*/
	parse_html_start() {
		this.chars_consume('<');
		const tag_name = this.parse_tag_name();
		const attributes = this.parse_attributes();
		this.chars_consume('>');

		return {
			type: TOKEN_HTML_START,
			tag_name,
			attributes,
		};
	}

	/**
		Parses a html end tag.
		@returns {Object} Token
	*/
	parse_html_end() {
		this.chars_consume('</');
		const tag_name = this.parse_tag_name();
		this.chars_consume('>');

		return {
			type: TOKEN_HTML_END,
			tag_name,
		};
	}

	/**
		Parses a liquid block.
		@param {boolean} must_yield - Whether the block must yield a (single) value
		@returns {Object} Token
	*/
	parse_liquid(must_yield) {
		// TODO (low priority): allow and store - at begin or end of liquid tags in the token so later, the whitespace can be removed/added to surrounding text nodes
		if (this.chars_match('{% comment')) {
			this.chars_consume_until('endcomment %}', 'liquid comment');
			return null;
		}
		if (this.chars_match('{{')) {
			this.chars_consume('{{');
			const expression = this.chars_consume_until('}}', 'liquid expression');
			return {
				type: TOKEN_EXPRESSION,
				value: expression.trim(),
			};
		}
		if (
			this.chars_match('{% if') ||
			this.chars_match('{% unless')
		) {
			return this.parse_liquid_conditional();
		}
		if (this.chars_match('{% for')) {
			// later, lists might be allowed inside html attributes too
			if (must_yield) this.error('Unexpected liquid loop');
			return this.parse_liquid_loop();
		}
		if (this.chars_match('{%')) {
			if (must_yield) this.error('Unexpected liquid script');
			return this.parse_liquid_script();
		}
		// this is not a liquid tag!
		this.char_step();
		return {
			type: TOKEN_TEXT,
			value: '{',
		};
	}

	/**
		Parses a liquid script tag.
		Handles stuff like variable assignments inside liquid script tags to have transformed values, other stuff is not supported for now.
		Returns nothing but defines the variables so that they can later be turned into transformations.
	*/
	parse_liquid_script() {
		this.chars_consume('{%');
		const content = this.chars_consume_until('%}', 'liquid script');
		// find variable assignments and store the variables and their definitions
	}
}

/**
	Converts an array of tokens into an optimized tree of nodes.
	@param {Array} tokens - Array of tokens to convert
	@returns {Array} Array of Nodes
*/
function nodes_from_tokens(tokens) {
	// TODO
}
