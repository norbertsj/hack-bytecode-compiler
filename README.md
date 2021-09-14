# Hack VM Translator

This a Virtual Machine implementation on [Hack platform](https://www.nand2tetris.org). It generates Hack ASM code.

## Arithmetic/Logic commands

| Command | Expression | Return type |
| ------- | ---------- | ----------- |
| add     | x+y        | integer     |
| sub     | x-y        | integer     |
| neg     | -y         | integer     |
| eq      | x == 0     | boolean     |
| gt      | x > y      | boolean     |
| lt      | x < y      | boolean     |
| and     | x AND y    | boolean     |
| or      | x OR y     | boolean     |
| not     | NOT x      | boolean     |

### Stack pointer position in relation to variables

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;x

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;y

SP -->&nbsp;...

## Segments

-   local
-   argument
-   this
-   that
-   constant
-   static
-   pointer
-   temp

## Memory map

| Symbol | Address   | Note                              |
| ------ | --------- | --------------------------------- |
| SP     | 0         | Stack pointer                     |
| LCL    | 1         | local segment                     |
| ARG    | 2         | argument segment                  |
| THIS   | 3         | this segment                      |
| THAT   | 4         | that segment                      |
| temp   | 5..12     |
| R13    | 13        |
| R14    | 14        |
| R15    | 15        |
| static | 16..255   | these are just Hack ASM variables |
| stack  | 256..2047 |

## Pointers

Pointer points to THIS or THAT segment base address

```
THAT = 0
THIS = 1
```

## Static

Static vars translate to Hack ASM variables

In file \<filename>.vm static vars translate to Hack ASM vars with name \<filename>.\<i>

## Pseudo code

#### push segment i

```
addr = segmentPointer + i
*SP = *addr
SP++
```

#### pop segment i

```
addr = segmentPointer + i
SP--
*addr = *SP
```

#### push constant i

```
*SP = i
SP++
```

#### push pointer 0/1

```
*SP = THIS/THAT
SP++
```

#### pop pointer 0/1

```
SP--
THIS/THAT = *SP
```

## VM code translations to Hack ASM

**NOTE**

\<> are used to denote dynamic values and \{} are references to previously defined code blocks (this is done to reduce code size in this readme file)

addr = segmentPointer + i

```
@<i>
D=A
@<segmentPointer>
A=D+M
```

*SP = *addr (presume: A=addr; M=\*addr)

```
D=M
@SP
A=M
M=D
```

*addr = *SP (presume: A=&SP; M=SP; D=addr)

```
@R15
M=D // save the addr in R15
@SP
A=M
D=M // D = *SP
@R15
A=M
M=D // and finally *addr = *SP
```

SP++

```
@SP
M=M+1
```

SP--

```
@SP
M=M-1
```

push segment i

```
{addr = segmentPointer + i}
{*SP = *addr}
{SP++}
```

pop segment i

```
{addr = segmentPointer + i}
D=A
{SP--}
{*addr = *SP}
```

push constant i

```
@<i>
D=A
@SP
A=M
M=D
{SP++}
```

push pointer <0/1>

```
@<THIS|THAT>
D=M
@SP
A=M
M=D
{SP++}
```

pop pointer <0|1>

```
{SP--}
A=M
D=M
@<THIS|THAT>
M=D
```

push static i

```
@<filename>.<i>
{*SP = *addr}
{SP++}
```

pop static i

```
@<filename>.<i>
D=A
{SP--}
{*addr = *SP}

```

add

```

{SP--}
A=M
D=M // this is y
@R15
M=D
{SP--}
A=M
D=M // this is x
@R15
D=D+M // x+y
@SP
A=M
M=D
{SP++}

```

sub

```

{SP--}
A=M
D=M
@R15
M=D
{SP--}
A=M
D=M
@R15
D=D-M
@SP
A=M
M=D
{SP++}

```

neg

```

{SP--}
A=M
D=-M
@SP
A=M
M=D
{SP++}

```

and

```

{SP--}
A=M
D=M
@R15
M=D
{SP--}
A=M
D=M
@R15
D=D&M
@SP
A=M
M=D
{SP++}

```

or

```

{SP--}
A=M
D=M
@R15
M=D
{SP--}
A=M
D=M
@R15
D=D|M
@SP
A=M
M=D
{SP++}

```

not

```

{SP--}
A=M
D=!M
@SP
A=M
M=D
{SP+

```

TRUE

```

(TRUE)
@SP
A=M
M=-1
{SP++}
@R13
A=M
0;JMP
```

FALSE

```
(FALSE)
@SP
A=M
M=0
{SP++}
@R13
A=M
0;JMP

```

EQ

```

(EQ)
{SP--}
A=M
D=M
@R15
M=D // y
(SP--)
A=M
D=M // x
@R15
D=D-M
@TRUE
D;JEQ
@FALSE
0;JMP

```

GT

```

(GT)
{SP--}
A=M
D=M
@R15
M=D // y
(SP--)
A=M
D=M // x
@R15
D=D-M
@TRUE
D;JGT
@FALSE
0;JMP

```

LT

```

(LT)
{SP--}
A=M
D=M
@R15
M=D // y
(SP--)
A=M
D=M // x
@R15
D=D-M
@TRUE
D;JLT
@FALSE
0;JMP

```

eq

```

@EQ.<N>.END
D=A
@R13
M=D
@EQ
0;JMP
(EQ.<N>.END)

```

gt

```

@GT.<N>.END
D=A
@R13
M=D
@GT
0;JMP
(GT.<N>.END)

```

lt

```

@LT.<N>.END
D=A
@R13
M=D
@LT
0;JMP
(LT.<N>.END)

```
