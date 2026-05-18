export const serviceName = 'partner-mcp-gateway';

export function buildReadyMessage(name: string = serviceName): string {
  return `${name} ready`;
}

function main(): void {
  console.log(buildReadyMessage());
}

if (require.main === module) {
  main();
}
