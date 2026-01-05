import lui_templates from '../src/main.js';
import fs from 'fs/promises';

console.log('Testing Liquid parser error handling...\n');

const testCases = [
	{
		name: 'Unclosed liquid expression',
		template: '<div>{{ unclosed</div>',
		shouldError: true,
	},
	{
		name: 'Unclosed if block',
		template: '<div>{% if test %}<p>Test</p></div>',
		shouldError: true,
	},
	{
		name: 'Unclosed unless block',
		template: '<div>{% unless test %}<p>Test</p></div>',
		shouldError: true,
	},
	{
		name: 'Unclosed attribute quote',
		template: '<div class="test><p>Test</p></div>',
		shouldError: true,
	},
	{
		name: 'Unexpected closing tag',
		template: '<div><p>Test</p></span></div>',
		shouldError: true,
	},
	{
		name: 'Valid template with variables',
		template: '<div>Hello {{ name }}!</div>',
		shouldError: false,
	},
	{
		name: 'Valid template with conditional',
		template: '<div>{% if show %}<p>Text</p>{% endif %}</div>',
		shouldError: false,
	},
	{
		name: 'Valid template with unless',
		template: '<div>{% unless hide %}<p>Text</p>{% endunless %}</div>',
		shouldError: false,
	},
];

let passed = 0;
let failed = 0;

async function runTest(testCase, i) {
	const tempFile = `/tmp/testliquid${i}.liquid`;
	try {
		await fs.writeFile(tempFile, testCase.template, 'utf8');
		
		// Try to parse
		await lui_templates(tempFile);
		
		// Clean up
		try { await fs.unlink(tempFile); } catch {}
		
		if (testCase.shouldError) {
			console.log(`❌ ${testCase.name}: Expected error but succeeded`);
			return false;
		}
		else {
			console.log(`✅ ${testCase.name}: Passed`);
			return true;
		}
	}
	catch (error) {
		// Clean up
		try { await fs.unlink(tempFile); } catch {}
		
		if (testCase.shouldError) {
			console.log(`✅ ${testCase.name}: Correctly reported error - ${error.message}`);
			return true;
		}
		else {
			console.log(`❌ ${testCase.name}: Unexpected error - ${error.message}`);
			return false;
		}
	}
}

for (let i = 0; i < testCases.length; i++) {
	if (await runTest(testCases[i], i)) {
		passed++;
	}
	else {
		failed++;
	}
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
