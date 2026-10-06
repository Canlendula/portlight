import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
await mkdir('build', { recursive: true })
const source = await readFile('public/icon.svg', 'utf8')
const png = new Resvg(source, { fitTo: { mode: 'width', value: 256 } }).render().asPng()
await writeFile('public/icon.png', png)
await writeFile('build/icon.ico', await pngToIco(png))
console.log('Windows icons generated.')
