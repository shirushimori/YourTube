const fs = require('fs');
const file = 'extension/content.js';
let content = fs.readFileSync(file, 'utf8');

// Insert setSafeHtml helper
const helper = `
  function setSafeHtml(el, html) {
    el.replaceChildren();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    el.append(...doc.body.childNodes);
  }
`;
content = content.replace(
  /function getVideoId\(\) \{[^\}]+\}/,
  (match) => match + '\n' + helper
);

// Replace assignments: var.innerHTML = ...;
content = content.replace(/([a-zA-Z0-9_]+)\.innerHTML\s*=\s*([^;]+);/g, (match, el, expr) => {
  // If it's a simple assignment
  return `setSafeHtml(${el}, ${expr});`;
});

// For multiline template literals: var.innerHTML = `...`;
content = content.replace(/([a-zA-Z0-9_]+)\.innerHTML\s*=\s*`([\s\S]*?)`;/g, (match, el, expr) => {
  return `setSafeHtml(${el}, \`${expr}\`);`;
});

fs.writeFileSync(file, content);
console.log('Fixed content.js');
