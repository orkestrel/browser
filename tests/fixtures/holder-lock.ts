import { createInterface } from 'node:readline'

createInterface({ input: process.stdin }).on('line', (path) => {
	process.chdir(path)
	process.stdout.write('locked\n')
})
process.stdout.write('ready\n')
