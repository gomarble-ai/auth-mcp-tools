# auth-mcp-tools

Authentication tools for Model Context Protocol (MCP) servers. This package provides utilities to manage, generate, and refresh authentication tokens, API keys, and credentials for MCP-compatible services.

## Features
- Retrieve tokens, API keys, and credentials from a secure local store
- Generate new authentication tokens via a browser-based flow
- Refresh expired tokens automatically
- Cross-platform support (macOS, Linux, Windows)
- CLI tool for easy integration and automation

## Installation

Install as a project dependency in <project_dir_base_path> Dir:

```sh
npm i auth-mcp-tools
```


## Usage
Update your mcp config
```json
{
    "mcpServers": {
        "auth-mcp-tools": {
            "command": "node",
            "args": [
                "<project_dir_base_path>/node_modules/auth-mcp-tools/build/index.js"
            ]
        }
        ...
}
```

## How It Works
- Credentials are stored in a platform-specific app data directory (e.g., `~/Library/Application Support/auth-mcp-tools/credentials.json` on macOS).
- Tokens are generated via a browser-based flow and polled until completion.
- Refresh tokens are used if available; otherwise, a new token is generated.

## Development

Build the project:

```sh
npm run build
```

The main source is in `src/index.ts`. The CLI entry point is `build/index.js`.

## Dependencies
- [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- [axios](https://www.npmjs.com/package/axios)
- [zod](https://www.npmjs.com/package/zod)
- [uuid](https://www.npmjs.com/package/uuid)

## License

ISC 
