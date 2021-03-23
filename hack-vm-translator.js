#!/usr/bin/env node
'use strict';

const { createReadStream, createWriteStream } = require('fs');
const { createInterface } = require('readline');

// @todo...
function translate(input) {
    const result = [];

    if (!input || input.length === 0) {
        throw new Error('Invalid input');
    }

    return result;
}

function main() {
    const args = process.argv.slice(2);
    const path = args[0];

    if (!path) {
        console.log('Please provide VM file as an argument (local dir only)');
        return;
    }

    const fileName = path.split('.')[0];
    const input = [];

    console.log(`Translating ${fileName}.vm file...`)

    const rl = createInterface({
        input: createReadStream(path),
        crlfDelay: Infinity
    });

    rl.on('line', (line) => input.push(line));
    rl.on('close', () => {
        const output = translate(input);
        const wstream = createWriteStream(`${fileName}.asm`);
        for (const line of output) {
            wstream.write(line + '\n');
        }

        console.log('Done');
    });
}

main();
