import { generate } from '../src/generator.js';
import parser from '../src/parsers/liquid.js';

(async () => {
console.log('Testing nested conditionals...\n');

// Test 1: Nested conditionals in content
console.log('=== Test 1: Nested conditionals in content ===');
const template1 = `<div>
  {% if outer %}
    <h1>Outer is true</h1>
    {% if inner %}
      <p>Both are true</p>
    {% endif %}
  {% endif %}
</div>`;

try {
  const result1 = await parser(template1, 'test1.liquid');
  console.log('✓ Parsed successfully');
  console.log('Inputs:', result1.inputs);
  const code1 = generate('Test1', result1);
  console.log('Generated code preview:', code1.substring(0, 200) + '...\n');
} catch (e) {
  console.error('✗ Failed:', e.message, '\n');
}

// Test 2: Nested conditionals in attributes
console.log('=== Test 2: Nested conditionals in attributes ===');
const template2 = `<button {% if enabled %}{% if primary %}class="btn-primary"{% endif %}{% endif %}>Click</button>`;

try {
  const result2 = await parser(template2, 'test2.liquid');
  console.log('✓ Parsed successfully');
  console.log('Inputs:', result2.inputs);
  const code2 = generate('Test2', result2);
  console.log('Generated code preview:', code2.substring(0, 200) + '...\n');
} catch (e) {
  console.error('✗ Failed:', e.message, '\n');
}

// Test 3: Boolean attributes with conditionals
console.log('=== Test 3: Boolean attributes with conditionals ===');
const template3 = `<button {% if isDisabled %}disabled{% endif %}>Submit</button>`;

try {
  const result3 = await parser(template3, 'test3.liquid');
  console.log('✓ Parsed successfully');
  console.log('Inputs:', result3.inputs);
  const code3 = generate('Test3', result3);
  console.log('Generated code preview:', code3.substring(0, 200) + '...\n');
} catch (e) {
  console.error('✗ Failed:', e.message, '\n');
}

// Test 4: Non-boolean attributes with conditionals
console.log('=== Test 4: Non-boolean attributes with conditionals ===');
const template4 = `<button {% if customClass %}class="{{ customClass }}"{% endif %}>Click</button>`;

try {
  const result4 = await parser(template4, 'test4.liquid');
  console.log('✓ Parsed successfully');
  console.log('Inputs:', result4.inputs);
  const code4 = generate('Test4', result4);
  console.log('Generated code preview:', code4.substring(0, 300) + '...\n');
} catch (e) {
  console.error('✗ Failed:', e.message, '\n');
}

// Test 5: Unless with boolean attributes
console.log('=== Test 5: Unless with boolean attributes ===');
const template5 = `<button {% unless isEnabled %}disabled{% endunless %}>Submit</button>`;

try {
  const result5 = await parser(template5, 'test5.liquid');
  console.log('✓ Parsed successfully');
  console.log('Inputs:', result5.inputs);
  const code5 = generate('Test5', result5);
  console.log('Generated code preview:', code5.substring(0, 200) + '...\n');
} catch (e) {
  console.error('✗ Failed:', e.message, '\n');
}

// Test 6: Unless with non-boolean attributes (swapped ternary)
console.log('=== Test 6: Unless with non-boolean attributes (swapped ternary) ===');
const template6 = `<button {% unless hideClass %}class="btn"{% endunless %}>Click</button>`;

try {
  const result6 = await parser(template6, 'test6.liquid');
  console.log('✓ Parsed successfully');
  console.log('Inputs:', result6.inputs);
  const code6 = generate('Test6', result6);
  console.log('Generated code preview:', code6.substring(0, 300) + '...\n');
} catch (e) {
  console.error('✗ Failed:', e.message, '\n');
}

// Test 7: Text nodes with nested conditionals
console.log('=== Test 7: Text nodes with nested conditionals ===');
const template7 = `<div>{% if show %}Hello {{ name }}!{% endif %}</div>`;

try {
  const result7 = await parser(template7, 'test7.liquid');
  console.log('✓ Parsed successfully');
  console.log('Inputs:', result7.inputs);
  const code7 = generate('Test7', result7);
  console.log('Generated code preview:', code7.substring(0, 300) + '...\n');
} catch (e) {
  console.error('✗ Failed:', e.message, '\n');
}

console.log('All tests completed!');
})();
