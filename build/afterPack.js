const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')
const { execSync } = require('child_process')
const path = require('path')

exports.default = async function afterPack({ appOutDir, packager }) {
  const appName = packager.appInfo.productName
  const platform = packager.platform.name // 'mac', 'windows', 'linux'

  if (platform === 'mac') {
    const appPath = path.join(appOutDir, `${appName}.app`)
    await flipFuses(appPath, {
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
    })
    console.log(`[afterPack] Fuses disabled: RunAsNode, AsarIntegrity`)
    // Sign nested frameworks first, then native addons, then the app
    const frameworksDir = path.join(appPath, 'Contents', 'Frameworks')
    try {
      const items = require('fs').readdirSync(frameworksDir)
      for (const item of items) {
        const itemPath = path.join(frameworksDir, item)
        execSync(`codesign --sign - --force "${itemPath}"`, { stdio: 'pipe' })
      }
    } catch { /* ignore individual framework signing failures */ }
    // Sign native Node.js addons in Resources (they are Mach-O binaries)
    const resourcesDir = path.join(appPath, 'Contents', 'Resources')
    try {
      const items = require('fs').readdirSync(resourcesDir)
      for (const item of items.filter(f => f.endsWith('.node'))) {
        const itemPath = path.join(resourcesDir, item)
        execSync(`codesign --sign - --force "${itemPath}"`, { stdio: 'pipe' })
        console.log(`[afterPack] Signed native addon: ${item}`)
      }
    } catch { /* ignore */ }
    execSync(`codesign --sign - --force "${appPath}"`, { stdio: 'inherit' })
    console.log(`[afterPack] Re-signed with ad-hoc signature`)
    execSync(`xattr -dr com.apple.quarantine "${appPath}"`, { stdio: 'pipe' })
    console.log(`[afterPack] Quarantine cleared`)
  } else if (platform === 'windows') {
    const appPath = path.join(appOutDir, `${appName}.exe`)
    await flipFuses(appPath, {
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
    })
    console.log(`[afterPack] Fuses disabled for Windows: RunAsNode, AsarIntegrity`)
  }
}
