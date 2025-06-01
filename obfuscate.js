const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, 'electron-app.js');
const outputFile = path.join(__dirname, 'electron-app.obfuscated.js');

console.log('Obfuscating Electron main process...');

const code = fs.readFileSync(inputFile, 'utf8');

const obfuscatedCode = JavaScriptObfuscator.obfuscate(code, {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  disableConsoleOutput: true,
  identifierNamesGenerator: 'hexadecimal',
  stringArray: true,
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  rotateStringArray: true
}).getObfuscatedCode();

fs.writeFileSync(outputFile, obfuscatedCode);

console.log('Obfuscation complete: electron-app.obfuscated.js');
