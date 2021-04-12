#!/usr/bin/env node
'use strict';

const { createReadStream, createWriteStream } = require('fs');
const { createInterface } = require('readline');

 const SegmentCodes = {
    local: 'LCL',
    argument: 'ARG',
    this: 'this',
    that: 'that',
    temp: 5
};

const CodeBlocks = {
    setAddress: (segment, i) => [
        `@${i}`,
        'D=A',
        `@${segment}`,
        'A=D+a'
    ],
    fromAddressToStack: () => [
        'D=M',
        '@SP',
        'A=M',
        'M=D'
    ],
    fromStackToAddress: () => [
        '@R15',
        'M=D',
        '@SP',
        'A=M',
        'D=M',
        '@R15',
        'A=M',
        'M=D'
    ],
    incrementStackPointer: () => [
        '@SP',
        'M=M+1'
    ],
    decrementStackPointer: () => [
        '@SP',
        'M=M-1'
    ],
    pushSegment: (segment, i) => [
        `// push ${segment} ${i}`,
        ...CodeBlocks.setAddress(segment, i),
        ...CodeBlocks.fromAddressToStack(),
        ...CodeBlocks.incrementStackPointer()
    ],
    popSegment: (segment, i) => [
        `// pop ${segment} ${i}`,
        ...CodeBlocks.setAddress(segment, i),
        'D=A',
        ...CodeBlocks.decrementStackPointer(),
        ...CodeBlocks.fromStackToAddress()
    ],
    pushConstant: (constant) => [
        `// push constant ${constant}`,
        `@${constant}`,
        'D=A',
        '@SP',
        'A=M',
        'M=D',
        ...CodeBlocks.incrementStackPointer()
    ],
    pushPointer: (pointer) => [
        `// push pointer ${pointer}`,
        `@${pointer === 1 ? 'THAT' : 'THIS'}`,
        'D=M',
        '@SP',
        'A=M',
        'M=D',
        ...CodeBlocks.incrementStackPointer()
    ],
    popPointer: (pointer) => [
        `// pop pointer ${pointer}`,
        ...CodeBlocks.decrementStackPointer(),
        'D=M',
        `@${pointer === 1 ? 'THAT' : 'THIS'}`,
        'M=D'
    ],
    pushStatic: (fileName, i) => [
        `// push static ${i}`,
        `@${fileName}.${i}`,
        ...CodeBlocks.fromAddressToStack(),
        ...CodeBlocks.incrementStackPointer()
    ],
    popStatic: (fileName, i) => [
        `// pop static ${i}`,
        `@${fileName}.${i}`,
        'D=A',
        ...CodeBlocks.decrementStackPointer(),
        ...CodeBlocks.fromStackToAddress()
    ],
    setXY: () => [
        ...CodeBlocks.decrementStackPointer(),
        'A=M',
        'D=M',
        '@R15',
        'M=D',
        ...CodeBlocks.decrementStackPointer(),
        'A=M',
        'D=M',
    ],
    pushResultToStack: () => [
        '@SP',
        'M=D',
        ...CodeBlocks.incrementStackPointer()
    ],
    add: () => [
        '// add',
        ...CodeBlocks.setXY(),
        '@R15',
        'D=D+M',
        ...CodeBlocks.pushResultToStack()
    ],
    sub: () => [
        '// sub',
        ...CodeBlocks.setXY(),
        '@R15',
        'D=D-M',
        ...CodeBlocks.pushResultToStack()
    ],
    neg: () => [
        '// neg',
        ...CodeBlocks.decrementStackPointer(),
        'A=M',
        'D=-M',
        ...CodeBlocks.pushResultToStack()
    ],
    and: () => [
        '// and',
        ...CodeBlocks.setXY(),
        '@R15',
        'D=D&M',
        ...CodeBlocks.pushResultToStack()
    ],
    or: () => [
        '// or',
        ...CodeBlocks.setXY(),
        '@R15',
        'D=D|M',
        ...CodeBlocks.pushResultToStack()
    ],
    not: () => [
        '// not',
        ...CodeBlocks.decrementStackPointer(),
        'A=M',
        'D=!M',
        ...CodeBlocks.pushResultToStack()
    ],
    true: () => [
        '(TRUE)',
        '    @SP',
        '    M=-1',
        ...CodeBlocks.incrementStackPointer().map(i => `    ${i}`),
        '    @R13',
        '    A=M',
        '    0;JMP'
    ],
    false: () => [
        '(FALSE)',
        '    @SP',
        '    M=0',
        ...CodeBlocks.incrementStackPointer().map(i => `    ${i}`),
        '    @R13',
        '    A=M',
        '    0;JMP'
    ],
    compare: (jump, label) => [
        `(${label})`,
        ...CodeBlocks.setXY().map(i => `    ${i}`),
        '    @R15',
        '    D=D-M',
        '    @TRUE',
        `    D;${jump}`,
        '    @FALSE',
        '    0;JMP'
    ],
    eq: (n) => [
        '// eq',
        `@EQ.${n}.END`,
        'D=A',
        '@R13',
        'M=D',
        '@EQ',
        '0;JMP',
        `(EQ.${n}.END)`
    ],
    lt: (n) => [
        '// lt',
        `@LT.${n}.END`,
        'D=A',
        '@R13',
        'M=D',
        '@LT',
        '0;JMP',
        `(LT.${n}.END)`
    ],
    gt: (n) => [
        '// gt',
        `@GT.${n}.END`,
        'D=A',
        '@R13',
        'M=D',
        '@GT',
        '0;JMP',
        `(GT.${n}.END)`
    ]
};

const Commands = [
    'add',
    'sub',
    'neg',
    'and',
    'or',
    'not',
    'eq',
    'lt',
    'gt'
];

const ComparisonCommands = [
    'eq',
    'lt',
    'gt'
];

// indicates if we need to add comparison code blocks at the top of the ASM file
let comparisonCommandsUsed = false;
let eqCount = 0;
let ltCount = 0;
let gtCount = 0;

function parseInstruction(instruction, fileName) {
    if (Commands.includes(instruction)) {
        if (ComparisonCommands.includes(instruction)) {
            comparisonCommandsUsed = true;
            let block;

            switch (instruction) {
                case 'eq':
                    block = CodeBlocks.eq(eqCount);
                    eqCount++;
                    break;
                case 'lt':
                    block = CodeBlocks.lt(ltCount);
                    ltCount++;
                    break;
                case 'gt':
                    block = CodeBlocks.gt(gtCount);
                    gtCount++;
                    break;
            }

            return block;
        }

        return CodeBlocks[instruction]();
    } else {
        const [operation, segment, i] = instruction.split(' ');

        if (Object.keys(SegmentCodes).includes(segment)) {
            if (operation === 'push') {
                return CodeBlocks.pushSegment(SegmentCodes[segment], i);
            }

            return CodeBlocks.popSegment(SegmentCodes[segment], i);
        }

        switch (segment) {
            case 'constant':
                return CodeBlocks.pushConstant(i);
            case 'static':
                if (operation === 'push') {
                    return CodeBlocks.pushStatic(fileName, i);
                }

                return CodeBlocks.popStatic(fileName, i);
            case 'pointer':
                if (operation === 'push') {
                    return CodeBlocks.pushPointer(i);
                }

                return CodeBlocks.popPointer(i);
            default:
                throw new Error('Invalid memory segment');
        }
    }
}

function removeCommentsAndEmptyLines(input) {
    const result = [];

    for (const line of input) {
        if (!line.startsWith('//') && line.trim() !== '') {
            result.push(line.trim());
        }
    }

    return result;
}

function translate(input, fileName) {
    if (!input || input.length === 0) {
        throw new Error('Invalid input');
    }

    const byteCode = removeCommentsAndEmptyLines(input);
    let asmCode = [];

    for (const line of byteCode) {
        asmCode = [...asmCode, ...parseInstruction(line, fileName), ''];
    }

    if (comparisonCommandsUsed) {
        asmCode = [
            '@START',
            '0;JMP',
            '',
            ...CodeBlocks.true(),
            '',
            ...CodeBlocks.false(),
            '',
            ...CodeBlocks.compare('JEQ', 'EQ'),
            '',
            ...CodeBlocks.compare('JLT', 'LT'),
            '',
            ...CodeBlocks.compare('JGT', 'GT'),
            '',
            '(START)',
            '',
            ...asmCode
        ];
    }

    return asmCode;
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
