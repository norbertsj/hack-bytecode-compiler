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
        `(${name})`
    ],
    labelInFunction: (name, functionName, fileName) => [
        `// label ${name} (inside function)`,
        `(${fileName}.${functionName}$${name})`
    ],
    goto: (label) => [
        `// goto ${label}`,
        `@${label}`,
        '0;JMP'
    ],
    ifgoto: (label) => [
        `// if-goto ${label}`,
        ...CodeBlocks.decrementStackPointer(),
        'A=M',
        'D=M',
        `@${label}`,
        'D;JNE' // if D !== 0 (true) => jump
    ],
    initFunction: (instruction, fileName) => {
        const [, functionName, nVars] = instruction.split(' ');
        currentFunction = `${fileName}.${functionName}`;
        let code = [
            `// ${instruction}`,
            `(${currentFunction})`
        ];
    
        if (nVars && parseInt(nVars, 10) !== 0) {
            for (let i = 0; i < parseInt(nVars, 10); i++) {
                const block = CodeBlocks.pushConstant(0);
                code = [...code, ...block];
            }
        }
    
        return code;
    },
    returnFromFunction: () => {
        currentFunction = null;

        return [
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
            '0;JMP'
        ];
    }
};

function parseInstruction(instruction, fileName) {
    if (instruction.startsWith('function')) {
        return CodeBlocks.initFunction(instruction, fileName);
    } else if (instruction === 'return') {
        return CodeBlocks.returnFromFunction();
    } else if (instruction.startsWith('label')) {
        // later: determine if the label is inside a function
        return CodeBlocks.label(instruction.split(' ').pop());
    } else if (instruction.startsWith('goto')) {
        // later: determine if the label is inside a function
        return CodeBlocks.goto(instruction.split(' ').pop());
    } else if (instruction.startsWith('if-goto')) {
        // later: determine if the label is inside a function
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

    let outputData, outputFile;

    if (parsedPath.ext === '.vm' && !stats.isDirectory()) {
        console.log(`Translating file ${parsedPath.base} into ${parsedPath.name}.asm...`);
        const input = await readFile(providedPath);
        outputData = translate(input, parsedPath.name);
        outputFile = parsedPath.name + '.asm';
    } else if (parsedPath.ext === '' && stats.isDirectory() && readdirSync(providedPath).length !== 0 && readdirSync(providedPath).map(f => f.toLowerCase()).includes('main.vm')) {
        console.log('Translating directory ===> TODO...');
        // const files = readdirSync(providedPath).map(f => f.toLowerCase());
        // console.log(files);

        // for (const file of files) {
        //     const data = await readFile(`${providedPath}/${file}`);
        //     console.log(data);
        // }
    } else {
        throw new Error('Invalid path (must be either a file with .vm extension or a directory with Main.vm/main.vm in it)');
    }

    if (parsedPath.dir.length > 0) {
        // write file to the same location where it was read from
        outputFile = `${parsedPath.dir}/${outputFile}`;
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
