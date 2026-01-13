# Liquid Template Syntax Specification

This document describes the Liquid template syntax used in this project. AI agents and contributors should follow these specifications when working with Liquid templates.

## Syntax Overview

Liquid uses two types of delimiters:

### 1. Output (Expressions): `{{ }}`
Used for outputting variables and expressions:
```liquid
{{ variable }}
{{ user.name }}
{{ "Hello " + name }}
```

### 2. Tags (Commands): `{% %}`
Used for logic, control flow, and special commands:
```liquid
{% if condition %}
  Content
{% endif %}

{% unless condition %}
  Content
{% endunless %}

{% for item in items %}
  {{ item }}
{% endfor %}
```

## Supported Commands

### Control Flow Commands
- `{% if condition %}...{% endif %}` - Conditional rendering
- `{% unless condition %}...{% endunless %}` - Inverse conditional rendering
- `{% for item in collection %}...{% endfor %}` - Loop over collections

### Special Commands
- `{% comment %}...{% endcomment %}` - Comments (not rendered)
- `{% raw %}...{% endraw %}` - Raw content (no processing)
- `{% render 'component', prop: value %}` - Render a component

## Component Rendering

The `{% render %}` command is used to instantiate components:

```liquid
{% render 'button', label: 'Submit', type: 'primary' %}
{% render 'user-card', name: user.name, age: 25 %}
{% render 'components/ui/icon', name: 'check', size: 24 %}
```

### Syntax
```liquid
{% render 'path/to/component', prop1: value1, prop2: value2 %}
```

### Rules
1. **Path**: The component path (string). Only the last segment is used (e.g., `'ui/button'` → `Button`)
2. **Component Name**: Converted to PascalCase (e.g., `'user-card'` → `UserCard`)
3. **Props**: Key-value pairs separated by commas
4. **Values**: Can be:
   - String literals: `'text'` or `"text"`
   - Numbers: `42`, `3.14`
   - Booleans: `true`, `false`
   - Variables: `userName`, `count`
   - Expressions: `user.name`, `items.length`

### Examples

Simple with static values:
```liquid
{% render 'button', label: 'Click me', disabled: false %}
```

With variables:
```liquid
{% render 'input', name: fieldName, value: fieldValue %}
```

With expressions:
```liquid
{% render 'user-card', name: user.name, count: items.length %}
```

Within conditionals:
```liquid
{% if showProfile %}
  {% render 'profile', user: currentUser %}
{% endif %}
```

## Important Notes for AI Agents

1. **Always use `{% %}` for the render command**, not `{{ }}`
2. The render command is a **tag/command**, not an expression
3. Component names are automatically converted from kebab-case to PascalCase
4. Only simple variable identifiers are registered as component inputs
5. Complex expressions (e.g., `user.name`) are passed through but not registered as inputs
