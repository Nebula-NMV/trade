const fs = require('node:fs');
const indicators = require('../indicators.js');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(indicators.calculate(input.rows)));
