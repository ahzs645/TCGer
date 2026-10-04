import { pathToFileURL } from 'node:url';
export function selectSimulator(inventory, name = 'iPhone 17 Pro') {
  const devices = Object.entries(inventory.devices).flatMap(([runtime, list]) => list.map(device => ({ ...device, runtime })));
  const matches = devices.filter(device => device.isAvailable !== false && device.name === name);
  matches.sort((a, b) => (Number(b.state === 'Booted') - Number(a.state === 'Booted')) || b.runtime.localeCompare(a.runtime, undefined, { numeric: true }) || a.udid.localeCompare(b.udid));
  if (!matches.length) throw new Error(`No available ${name} simulator`);
  return matches[0].udid;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  process.stdout.write(selectSimulator(JSON.parse(input), process.env.IOS_SIMULATOR));
}
