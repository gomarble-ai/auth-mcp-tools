import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from 'axios';
import { exec } from 'child_process';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import https from 'https';


// Create server instance
const server = new McpServer({
  name: "auth-mcp-tools",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Get platform-specific app data path
const getAppDataPath = (): string => {
  const homeDir = os.homedir();
  
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'auth-mcp-tools');
    case 'darwin':
      return path.join(homeDir, 'Library', 'Application Support', 'auth-mcp-tools');
    case 'linux':
      return path.join(homeDir, '.config', 'auth-mcp-tools');
    default:
      return path.join(homeDir, '.auth-mcp-tools');
  }
};

// Helper function to open URLs
const openUrl = (url: string): Promise<void> => {
  const command = process.platform === 'win32' ? 'start' :
                 process.platform === 'darwin' ? 'open' : 'xdg-open';
  
  return new Promise((resolve, reject) => {
    exec(`${command} "${url}"`, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

server.tool(
    "get-tokens-api-keys-credentials-from-store",
    "This tool will get the tokens, api keys, and credentials for the user from the store",
    {},
    async () => {
        const appDataPath = getAppDataPath();
        const fullPath = path.join(appDataPath, "credentials.json");
        if (!existsSync(fullPath)) {
            return {
                content: [
                    { type: "text", text: "No credentials found in store. Please use the get-auth-token tool to get a token" }
                ]
            };
        }
        const credentials = await fs.readFile(fullPath, 'utf8');
        const credentialsJson = JSON.parse(credentials);
        return {
            content: [
                { type: "text", text: JSON.stringify(credentialsJson) }
            ]
        };
    }
);

server.tool(
    "get-auth-token",
    "Get an auth token for the user given auth url. This tool will check if token is already generated and saved to file. If not, it will generate a token and save it to file and return the token. If token is already generated and saved to file, it will return the token.",
    {
      url: z.string().describe("The auth url to generate a token"),
      force_generate_new_token: z.boolean().describe("If true, the tool will generate a new token even if one already exists")
    },
    async ({ url, force_generate_new_token }) => {
        const appDataPath = getAppDataPath();
        const fullPath = path.join(appDataPath, "credentials.json");
        const credentials = await fs.readFile(fullPath, 'utf8');
        const credentialsJson = JSON.parse(credentials);
        const key = url.split("/").pop() || "";
        const accessToken = credentialsJson[`${key}_access_token`];
        if (accessToken && !force_generate_new_token) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            status: "success",
                            message: "Access token successfully read from file",
                            token: accessToken
                        })
                    }
                ]
            };
        } else {
            const requestId = uuidv4();
            const authStartUrl = `${url}/start?request_id=${requestId}`;
            const tokenFetchUrl = `${url}/get-token?request_id=${requestId}`;

            try {
                await openUrl(authStartUrl);
            } catch (e: any) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ 
                                status: "error", 
                                message: `Warning: Could not open web browser automatically; Please manually navigate to: ${authStartUrl}`
                            })
                        }
                    ]
                };
            }
            
            // Poll for token completion
            const maxAttempts = 6; // 1 minute (10-second intervals)
            
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                try {
                    // Wait 10 seconds between attempts
                    await new Promise(resolve => setTimeout(resolve, 10000));
                    
                    // Make request with timeout
                    const response = await axios.get(tokenFetchUrl, { 
                        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
                        timeout: 15000 
                    });
                    
                    
                    if (response.status !== 200) {
                        continue;
                    }
                    
                    const data = response.data;
                    
                    if (data.status === "pending") {
                        continue;
                    }
                    
                    if (data.status === "error") {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify({ 
                                        status: "error", 
                                        message: data.message || "Unknown error from auth server" 
                                    })
                                }
                            ]
                        };
                    }
                    
                    if (data.status === "success") {
                        const accessToken = data.access_token;
                        const key = url.split("/").pop() || "";
                        credentialsJson[`${key}_access_token`] = accessToken;
                        await fs.writeFile(fullPath, JSON.stringify(credentialsJson, null, 2));
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify({
                                        status: "success",
                                        message: "Access token successfully generated and saved to credentials store",
                                        token: accessToken
                                    })
                                }
                            ]
                        };
                    }
                } catch (e: any) {
                    // Continue to next attempt on error
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    tokenFetchUrl: tokenFetchUrl,
                                    authStartUrl: authStartUrl,
                                    status: "info", 
                                    message: e.message
                                })
                            }
                        ]
                    }
                }
            }
            
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            status: "error",
                            message: `Timeout or maximum attempts reached: Authentication did not complete successfully within ${maxAttempts*10} seconds`
                        })
                    }
                ]
            };
        }
    }
)

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Auth MCP Server running on stdio");
  }
  
  main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
  });