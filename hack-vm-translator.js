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
 * ------------------------
 *       x
 *       y
 * SP -> ..
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
 * Memory map
 * SP     0 Stack pointer
 * LCL    1 local segment
 * ARG    2 argument segment
 * THIS   3 this segment
 * THAT   4 that segment
 * temp   5..12
 * R13    13
 * R14    14
 * R15    15
 * static 16..255 (these are just Hack ASM variables)
 * stack  256..2047
 *
 * pointer is either 0/1 (points to THIS or THAT segment base address)
 * THAT = 0
 * THIS = 1
 *
 * Pointers in general
 * ptr  = <addr>
 * &ptr = Memory[<ptr>]
 * *ptr = Memory[<addr>]
 *
 * push segment i
 * addr = segmentPointer + i; *SP = *addr; SP++
 *
 * pop segment i
 * addr = segmentPointer + i; SP--; *addr = *SP
 *
 * push constant i
 * *SP = i; SP++
 *
 * push pointer 0/1
 * *SP = THIS/THAT; SP++
 *
 * pop pointer 0/1
 * SP--; THIS/THAT = *SP
 *
 * Static
 * Static vars translate to Hack ASM variables
 * In file <filename>.vm static vars translate to Hack ASM vars with name <filename>.<i>
 *
 *
 * Lets try writing Hack assembly here to see how to actually implement
 *
 * // addr = segmentPointer + i
 * @<i>
 * D=A
 * @<segmentPointer(LCL|ARG|THIS|THAT|5(temp))>
 * A=D+A
 *
 * // *SP = *addr (presume: A=addr; M=*addr)
 * D=M
 * @SP
 * A=M
 * M=D
 *
 * // *addr = *SP (presume: A=&SP; M=SP; D=addr)
 * @R15
 * M=D // save the addr in R15
 * @SP
 * A=M
 * D=M // D = *SP
 * @R15
 * A=M
 * M=D // and finally *addr = *SP
 *
 * // SP++
 * @SP
 * M=M+1
 *
 * // SP--
 * @SP
 * M=M-1
 *
 * // push segment i
 * {addr = segmentPointer + i}
 * {*SP = *addr}
 * {SP++}
 *
 * // pop segment i
 * {addr = segmentPointer + i}
 * D=A
 * {SP--}
 * {*addr = *SP}
 *
 * // push constant <CONST>
 * @<CONST>
 * D=A
 * @SP
 * A=M
 * M=D
 * {SP++}
 *
 * // push pointer <0|1>
 * @<THIS|THAT>
 * D=M
 * @SP
 * A=M
 * M=D
 * {SP++}
 *
 * // pop pointer <0|1>
 * {SP--}
 * D=M // presuming M = *SP
 * @<THIS|THAT>
 * M=D
 *
 * // push static i
 * @<filename>.<i>
 * {*SP = *addr}
 * {SP++}
 *
 * // pop static i
 * @<filename>.<i>
 * D=A
 * {SP--}
 * {*addr = *SP}
 *
 * // add
 * {SP--}
 * A=M
 * D=M // this is y
 * @R15
 * M=D
 * {SP--}
 * A=M
 * D=M // this is x
 * @R15
 * D=D+M // x+y
 * @SP
 * M=D
 * {SP++}
 *
 * // sub
 * {SP--}
 * A=M
 * D=M
 * @R15
 * M=D
 * {SP--}
 * A=M
 * D=M
 * @R15
 * D=D-M
 * @SP
 * M=D
 * {SP++}
 *
 * // neg
 * {SP--}
 * A=M
 * D=-M
 * @SP
 * M=D
 * {SP++}
 *
 *
 * (TRUE)
 *     @SP
 *     M=-1
 *     {SP++}
 *     @R13
 *     0;JMP
 * (FALSE)
 *     @SP
 *     M=0
 *     {SP++}
 *     @R13
 *     0;JMP
 *
 * (EQ)
 * {SP--}
 * A=M
 * D=M
 * @R15
 * M=D // y
 * (SP--)
 * A=M
 * D=M // x
 * @R15
 * D=D-M
 * @TRUE
 * D;JEQ
 * @FALSE
 * 0;JMP
 *
 * (GT)
 * {SP--}
 * A=M
 * D=M
 * @R15
 * M=D // y
 * (SP--)
 * A=M
 * D=M // x
 * @R15
 * D=D-M
 * @TRUE
 * D;JGT
 * @FALSE
 * 0;JMP
 *
 * (LT)
 * {SP--}
 * A=M
 * D=M
 * @R15
 * M=D // y
 * (SP--)
 * A=M
 * D=M // x
 * @R15
 * D=D-M
 * @TRUE
 * D;JLT
 * @FALSE
 * 0;JMP
 *
 * // eq
 * @EQ.<N>.END
 * D=A
 * @R13
 * M=D
 * @EQ
 * 0;JMP
 * (EQ.<N>.END)
 *
 * // gt
 * @GT.<N>.END
 * D=A
 * @R13
 * M=D
 * @GT
 * 0;JMP
 * (GT.<N>.END)
 *
 * // lt
 * @LT.<N>.END
 * D=A
 * @R13
 * M=D
 * @LT
 * 0;JMP
 * (LT.<N>.END)
 *
 * // and
 * {SP--}
 * A=M
 * D=M
 * @R15
 * M=D
 * {SP--}
 * A=M
 * D=M
 * @R15
 * D=D&M
 * @SP
 * M=D
 * {SP++}
 *
 * // or
 * {SP--}
 * A=M
 * D=M
 * @R15
 * M=D
 * {SP--}
 * A=M
 * D=M
 * @R15
 * D=D|M
 * @SP
 * M=D
 * {SP++}
 *
 * // not
 * {SP--}
 * A=M
 * D=!M
 * @SP
 * M=D
 * {SP++}
 *
 */

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
        `@${constant}`,
        'D=A',
        '@SP',
        'A=M',
        'M=D',
        ...CodeBlocks.incrementStackPointer()
    ],
    pushPointer: (pointer) => [
        `@${pointer === 1 ? 'THAT' : 'THIS'}`,
        'D=M',
        '@SP',
        'A=M',
        'M=D',
        ...CodeBlocks.incrementStackPointer()
    ],
    popPointer: (pointer) => [
        ...CodeBlocks.decrementStackPointer(),
        'D=M',
        `@${pointer === 1 ? 'THAT' : 'THIS'}`,
        'M=D'
    ],
    pushStatic: (fileName, i) => [
        `@${fileName}.${i}`,
        ...CodeBlocks.fromAddressToStack(),
        ...CodeBlocks.incrementStackPointer()
    ],
    popStatic: (fileName, i) => [
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
        ...CodeBlocks.setXY(),
        '@R15',
        'D=D+M',
        ...CodeBlocks.pushResultToStack()
    ],
    sub: () => [
        ...CodeBlocks.setXY(),
        '@R15',
        'D=D-M',
        ...CodeBlocks.pushResultToStack()
    ],
    neg: () => [
        ...CodeBlocks.decrementStackPointer(),
        'A=M',
        'D=-M',
        ...CodeBlocks.pushResultToStack()
    ],
    and: () => [
        ...CodeBlocks.setXY(),
        '@R15',
        'D=D&M',
        ...CodeBlocks.pushResultToStack()
    ],
    or: () => [
        ...CodeBlocks.setXY(),
        '@R15',
        'D=D|M',
        ...CodeBlocks.pushResultToStack()
    ],
    not: () => [
        ...CodeBlocks.decrementStackPointer(),
        'A=M',
        'D=!M',
        ...CodeBlocks.pushResultToStack()
    ],
    true: () => [
        '(TRUE)',
        '@SP',
        'M=-1',
        ...CodeBlocks.incrementStackPointer(),
        '@R13',
        '0;JMP'
    ],
    false: () => [
        '(FALSE)',
        '@SP',
        'M=0',
        ...CodeBlocks.incrementStackPointer(),
        '@R13',
        '0;JMP'
    ],
    compare: (jump, label) => [
        `(${label})`,
        ...CodeBlocks.setXY(),
        '@R15',
        'D=D-M',
        '@TRUE',
        `D;${jump}`,
        '@FALSE',
        '0;JMP'
    ],
    eq: (n) => [
        `@EQ.${n}.END`,
        'D=A',
        '@R13',
        'M=D',
        '@EQ',
        '0;JMP',
        `(EQ.${n}.END)`
    ],
    lt: (n) => [
        `@LT.${n}.END`,
        'D=A',
        '@R13',
        'M=D',
        '@LT',
        '0;JMP',
        `(LT.${n}.END)`
    ],
    gt: (n) => [
        `@GT.${n}.END`,
        'D=A',
        '@R13',
        'M=D',
        '@GT',
        '0;JMP',
        `(GT.${n}.END)`
    ]
}

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
