#!/usr/bin/env node
'use strict';

const { createReadStream, createWriteStream, statSync, readdirSync } = require('fs');
const { createInterface } = require('readline');
const path = require('path');

const SegmentCodes = {
    local: 'LCL',
    argument: 'ARG',
    this: 'THIS',
    that: 'THAT',
    temp: 5
};

const Pointers = {
    '0': 'THIS',
    '1': 'THAT'
}

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

// indicates which function currently we are translating (if any)
let currentFunction = null;

// dictionary for tracking call count in current function
const calls = {};

const CodeBlocks = {
    setAddress: (segment, i) => [
        `@${i}`,
        'D=A',
        `@${segment}`,
        segment === SegmentCodes.temp ? 'A=D+A' : 'A=D+M'
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
        ...CodeBlocks.setAddress(segment, i),
        ...CodeBlocks.fromAddressToStack(),
        ...CodeBlocks.incrementStackPointer()
    ],
    popSegment: (segment, i) => [
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
        `@${Pointers[pointer]}`,
        'D=M',
        '@SP',
        'A=M',
        'M=D',
        ...CodeBlocks.incrementStackPointer()
    ],
    popPointer: (pointer) => [
        `// pop pointer ${pointer}`,
        ...CodeBlocks.decrementStackPointer(),
        'A=M',
        'D=M',
        `@${Pointers[pointer]}`,
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
        'A=M',
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
        '    A=M',
        '    M=-1',
        ...CodeBlocks.incrementStackPointer().map(i => `    ${i}`),
        '    @R13',
        '    A=M',
        '    0;JMP'
    ],
    false: () => [
        '(FALSE)',
        '    @SP',
        '    A=M',
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
    ],
    label: (name) => [
        `// label ${name}`,
        `(${currentFunction ? currentFunction + '$' + name : name})`
    ],
    goto: (label) => [
        `// goto ${label}`,
        `@${currentFunction ? currentFunction + '$' + label : label}`,
        '0;JMP'
    ],
    ifgoto: (label) => [
        `// if-goto ${label}`,
        ...CodeBlocks.decrementStackPointer(),
        'A=M',
        'D=M',
        `@${currentFunction ? currentFunction + '$' + label : label}`,
        'D;JNE' // if D !== 0 (true) => jump
    ],
    handleFunction: (instruction) => {
        const [, functionName, nVars] = instruction.split(' ');
        currentFunction = functionName;
        let code = [
            `// ${instruction}`,
            `(${functionName})`
        ];

        if (nVars && parseInt(nVars, 10) !== 0) {
            for (let i = 0; i < parseInt(nVars, 10); i++) {
                const block = CodeBlocks.pushConstant(0);
                code = [...code, ...block];
            }
        }

        return code;
    },
    handleCall: (instruction) => {
        const [, functionName, nArgs] = instruction.split(' ');

        if (typeof calls[currentFunction] !== 'undefined') {
            calls[currentFunction] += 1;
        } else {
            calls[currentFunction] = 1;
        }

        const returnAddressLabel = `${currentFunction}$ret.${calls[currentFunction]}`;

        let code = [
            `// ${instruction}`,
            // push returnAddressLabel
            `@${returnAddressLabel}`,
            'D=A',
            '@SP',
            'A=M',
            'M=D',
            ...CodeBlocks.incrementStackPointer(),
            // push LCL
            '@LCL',
            'D=M',
            '@SP',
            'A=M',
            'M=D',
            ...CodeBlocks.incrementStackPointer(),
             // push ARG
             '@ARG',
             'D=M',
             '@SP',
             'A=M',
             'M=D',
             ...CodeBlocks.incrementStackPointer(),
              // push THIS
            '@THIS',
            'D=M',
            '@SP',
            'A=M',
            'M=D',
            ...CodeBlocks.incrementStackPointer(),
             // push THAT
             '@THAT',
             'D=M',
             '@SP',
             'A=M',
             'M=D',
             ...CodeBlocks.incrementStackPointer(),
             // set ARG for callee (part 1)
             '@SP',
             'D=M-1',
             'D=D-1',
             'D=D-1',
             'D=D-1',
             'D=D-1',
        ];

        // set ARG for callee (part 2)
        if (nArgs && parseInt(nArgs, 10) !== 0) {
            for (let i = 0; i < parseInt(nArgs, 10); i++) {
                code.push('D=D-1');
            }
        }

        code = [
            ...code,
            '@ARG',
            'M=D',
            // LCL = SP
            '@SP',
            'D=M',
            '@LCL',
            'M=D',
            // goto functionName
            `@${functionName}`,
            '0;JMP',
            // (returnAddressLabel)
            `(${returnAddressLabel})`
        ];

        return code;
    },
    handleReturn: () => [
        '// return',
        // save callers endframe address (which is callees LCL)
        '@LCL',
        'D=M',
        '@ENDFRAME',
        'M=D',
        // save callers return address (endframe - 5)
        'D=D-1',
        'D=D-1',
        'D=D-1',
        'D=D-1',
        'D=D-1',
        'A=D',
        'D=M',
        '@RETADDR',
        'M=D',
        // store callees return value into ARG
        ...CodeBlocks.popSegment('ARG', 0),
        // restore SP for caller (SP = ARG + 1)
        '@ARG',
        'D=M',
        '@SP',
        'M=D+1',
        // restore THAT for caller (THAT = *(endframe - 1))
        '@ENDFRAME',
        'A=M-1',
        'D=M',
        '@THAT',
        'M=D',
        // restore THIS for caller (THIS = *(endframe - 2))
        '@ENDFRAME',
        'A=M-1',
        'A=A-1',
        'D=M',
        '@THIS',
        'M=D',
        // restore ARG for caller (ARG = *(endframe - 3))
        '@ENDFRAME',
        'A=M-1',
        'A=A-1',
        'A=A-1',
        'D=M',
        '@ARG',
        'M=D',
        // restore LCL for caller (LCL = *(endframe - 4))
        '@ENDFRAME',
        'A=M-1',
        'A=A-1',
        'A=A-1',
        'A=A-1',
        'D=M',
        '@LCL',
        'M=D',
        // jump to callers return address
        '@RETADDR',
        'A=M',
        '0;JMP'
    ],
    boot: () => [
        '// booting up',
        // SP = 256 (setting to 261 to simulate frame save for 'call Sys.init')
        '@261',
        'D=A',
        '@SP',
        'M=D',
        // call Sys.init (initial stack frame is all zeroes)
        '@Sys.init',
        '0;JMP'
    ]
};

function parseInstruction(instruction, fileName) {
    if (instruction.startsWith('function')) {
        return CodeBlocks.handleFunction(instruction);
    } else if (instruction.startsWith('call')) {
        return CodeBlocks.handleCall(instruction);
    } else if (instruction === 'return') {
        return CodeBlocks.handleReturn();
    } else if (instruction.startsWith('label')) {
        return CodeBlocks.label(instruction.split(' ').pop());
    } else if (instruction.startsWith('goto')) {
        return CodeBlocks.goto(instruction.split(' ').pop());
    } else if (instruction.startsWith('if-goto')) {
        return CodeBlocks.ifgoto(instruction.split(' ').pop());
    } else if (Commands.includes(instruction)) {
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
                return [`// push ${segment} ${i}`, ...CodeBlocks.pushSegment(SegmentCodes[segment], i)];
            }

            return [`// pop ${segment} ${i}`, ...CodeBlocks.popSegment(SegmentCodes[segment], i)];
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
                throw new Error(`Invalid instruction - ${instruction}`);
        }
    }
}

function removeCommentsAndEmptyLines(input) {
    const result = [];

    for (const line of input) {
        const stripped = line.replace(/\/+.*$/gm, '').trim();

        if (stripped.length > 0) {
            result.push(stripped);
        }
    }

    return result;
}

function translateFile(input, fileName) {
    if (!input || input.length === 0) {
        throw new Error('Invalid input');
    }

    const byteCode = removeCommentsAndEmptyLines(input);
    let asmCode = [];

    for (const line of byteCode) {
        asmCode = [...asmCode, ...parseInstruction(line, fileName), ''];
    }

    return asmCode;
}

function translateFiles(files, boot = false) {
    let asmCode = [];

    for (const file of files) {
        asmCode = [...asmCode, ...translateFile(file.data, file.name)];
    }

    if (boot) {
        asmCode = [
            ...CodeBlocks.boot(),
            '',
            ...asmCode
        ];
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

function writeFile(filePath, data) {
    const wstream = createWriteStream(filePath);

    for (const line of data) {
        wstream.write(line + '\n');
    }
}

function readFile(filePath) {
    return new Promise((resolve) => {
        const data = [];

        const rl = createInterface({
            input: createReadStream(filePath),
            crlfDelay: Infinity
        });

        rl.on('line', (line) => data.push(line));

        rl.on('close', () => {
            resolve(data);
        });
    });
}

async function run() {
    const args = process.argv.slice(2);
    const providedPath = args[0];

    if (!providedPath) {
        throw new Error('Path is missing');
    }

    const parsedPath = path.parse(providedPath);
    const stats = statSync(providedPath);

    let outputData = [], outputFile, isDir = false;

    if (parsedPath.ext === '.vm' && !stats.isDirectory()) {
        console.log(`Translating file ${parsedPath.base} into ${parsedPath.name}.asm...`);
        const input = await readFile(providedPath);
        outputData = translateFiles([{ data: input, name: parsedPath.name }]);
        outputFile = parsedPath.name + '.asm';
    } else if (parsedPath.ext === '' && stats.isDirectory() && readdirSync(providedPath).length !== 0) {
        console.log(`Translating directory into ${parsedPath.base}.asm`);
        isDir = true;
        const files = readdirSync(providedPath).filter(f => f.includes('.vm'));
        const filesToTranslate = [];

        for (const file of files) {
            const data = await readFile(`${providedPath}/${file}`);
            filesToTranslate.push({ data, name: file });
        }

        outputData = translateFiles(filesToTranslate, true);
        outputFile = parsedPath.base + '.asm';
    } else {
        throw new Error('Invalid path (must be either a file with .vm extension or a directory with *.vm files in it)');
    }

    if (parsedPath.dir.length > 0) {
        // write file to the same location where it was read from
        outputFile = isDir ? `${parsedPath.dir}/${parsedPath.base}/${outputFile}` : `${parsedPath.dir}/${outputFile}`;
    }

    writeFile(outputFile, outputData);
    console.log('Done!');
}

function main() {
    try {
        run();
    } catch (e) {
        console.log(`Error: ${e.message}`);
    }
}

main();
