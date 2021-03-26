#!/usr/bin/env node
'use strict';

const { createReadStream, createWriteStream } = require('fs');
const { createInterface } = require('readline');

/**
 *
 * Arithmetic/Logic commands
 * add | x+y     | integer
 * sub | x-y     | integer
 * neg | -y      | integer
 * eq  | x == 0  | boolean
 * gt  | x > y   | boolean
 * lt  | x < y   | boolean
 * and | x AND y | boolean
 * or  | x OR y  | boolean
 * not | NOT x   | boolean
 *
 *
 * Segments
 * local
 * argument
 * this
 * that
 * constant
 * static
 * pointer
 * temp
 *
 * Pointers
 * &ptr (address of pointer variable itself)
 * ptr = <addr> (Memory[&ptr] holds some address)
 * *ptr = Memory[addr]
 *
 * push segment i
 * addr = segmentPointer + i; *SP = *addr; SP++
 *
 * pop segment i
 * addr = segmentPointer + i; SP--; *addr = *SP
 *
 */

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
