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
 * (addr = segmentPointer + i)
 * (*SP = *addr) 
 * (SP++)
 * 
 * // pop segment i
 * (addr = segmentPointer + i)
 * D=A
 * (SP--)
 * (*addr = *SP)
 * 
 * // push constant <CONST>
 * @<CONST>
 * D=A
 * @SP
 * A=M
 * M=D
 * (SP++)
 * 
 * // push pointer <0|1>
 * @<THIS|THAT>
 * D=M
 * @SP
 * A=M
 * M=D
 * (SP++)
 * 
 * // pop pointer <0|1>
 * (SP--)
 * D=M // presuming M = *SP
 * @<THIS|THAT>
 * M=D
 * 
 * // push static i
 * @<filename>.<i>
 * (*SP = *addr) 
 * (SP++)
 * 
 * // pop static i
 * @<filename>.<i>
 * D=A
 * (SP--)
 * (*addr = *SP)
 * 
 * // Stack arithmetic
 * x = SP-2
 * y = SP-1
 * Pseudo:
 * SP-- (now points to y)
 * save y in temp
 * SP-- (now points to x)
 * save x in temp
 * calculate and store value in SP
 * SP++
 * 
 * // add
 * (SP--)
 * A=M
 * D=M // this is y
 * @R15
 * M=D 
 * (SP--)
 * A=M
 * D=M // this is x
 * @R15
 * D=D+M // x+y
 * @SP
 * M=D
 * (SP++)
 * 
 * // sub
 * (SP--)
 * A=M
 * D=M
 * @R15
 * M=D
 * (SP--)
 * A=M
 * D=M
 * @R15
 * D=D-M
 * @SP
 * M=D
 * (SP++)
 * 
 * // neg
 * (SP--)
 * A=M
 * D=-M
 * @SP
 * M=D
 * (SP++)
 * 
 * // eq
 * (TRUE)
 *     @SP
 *     M=-1
 *     (SP++)
 * (FALSE)
 *     @SP
 *     M=0
 *     (SP++)
 * (SP--)
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
 * // gt
 * idea: JGT x-y
 * 
 * // lt
 * idea: JLT x-y
 * 
 * 
 * // and
 * (SP--)
 * A=M
 * D=M
 * @R15
 * M=D
 * (SP--)
 * A=M
 * D=M
 * @R15
 * D=D&M
 * @SP
 * M=D
 * (SP++)
 * 
 * // or
 * (SP--)
 * A=M
 * D=M
 * @R15
 * M=D
 * (SP--)
 * A=M
 * D=M
 * @R15
 * D=D|M
 * @SP
 * M=D
 * (SP++)
 * 
 * // not
 * (SP--)
 * A=M
 * D=!M
 * @SP
 * M=D
 * (SP++)
 * 
 * Ultimate question: how am I gonna jump back to correct routine (if I use jumps)?
 */


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
