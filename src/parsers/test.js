import {
	NODE_TYPE_ELEMENT,
	VALUE_TYPE_FIELD,
	VALUE_TYPE_STATIC,
	VALUE_TYPE_STRING_CONCAT,
} from '../constants.js';

export default async function parseTest(src, path) {
	const greeting = src.trim();

	return {
		inputs: [
			{
				name: 'name',
				fallback: 'unknown',
			},
		],
		transformations: [],
		effects: [],
		nodes: [
			{
				type: NODE_TYPE_ELEMENT,
				tag: 'h1',
				attrs: {
					innerText: {
						type: VALUE_TYPE_STRING_CONCAT,
						data: [
							{
								type: VALUE_TYPE_STATIC,
								data: greeting + ' ',
							},
							{
								type: VALUE_TYPE_FIELD,
								data: 'name',
							},
							{
								type: VALUE_TYPE_STATIC,
								data: '!',
							},
						],
					},
					title: {
						type: VALUE_TYPE_STATIC,
						data: 'Just a test',
					},
				},
				children: [],
			},
		],
	};
}
