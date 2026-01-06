import lui_templates from '../src/main.js';

const test = async () => {
	const file = process.argv[2]; // Optional: pass specific file via argv
	const options = file ? { file } : {};
	const result = await lui_templates('templates', options);
	console.log(result);
}
test();
