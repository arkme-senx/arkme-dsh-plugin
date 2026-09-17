import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'tsdown'
const outDir = process.argv[2]
if (!outDir) throw new Error('Pass a temporary output directory')
// The Node export intentionally stubs CSS modules. Use the runtime's real Menu
// styles in this browser fixture so hit-testing exercises production positioning.
const menuCss = await readFile(path.resolve('../arkme-dsh-client/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/Menu.module.css'), 'utf8')
const menuClasses = Object.fromEntries([...menuCss.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(match => [match[1], 'smokeMenu_' + match[1]]))
const scopedMenuCss = menuCss.replace(/\.([A-Za-z_][\w-]*)/g, (_, name) => '.' + menuClasses[name])
await build({config:false,plugins:[{name:'native-menu-css',transform(code,id) {
 if (!id.includes('dsh-client-ui-primitives') || !code.includes('var Menu_module_css_default = {};')) return
 return code.replace('var Menu_module_css_default = {};', 'var Menu_module_css_default = ' + JSON.stringify(menuClasses) + ';\nconst menuStyles=document.createElement("style");menuStyles.textContent=' + JSON.stringify(scopedMenuCss) + ';document.head.append(menuStyles);')
}}],entry:{conversation:'tests/fixtures/conversation-window-entry.tsx'},outDir,
 format:'esm',platform:'browser',target:'es2022',deps:{alwaysBundle:[/.*/],onlyBundle:false},dts:false,sourcemap:false,
 loader:{'.svg':'base64','.png':'base64'},define:{'process.env.NODE_ENV':JSON.stringify('production')},})
