import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function connectToPythonServer() {
    // Transport setup karein jo aapke python server ko chalayega
    const transport = new StdioClientTransport({
        command: "d:/Desktop/6th Semester/AI_Driven/MCP_Server/venv/Scripts/python.exe",
        args: ["d:/Desktop/6th Semester/AI_Driven/MCP_Server/server.py"]
    });

    const client = new Client(
        { name: "queue-management-client", version: "1.0.0" },
        { capabilities: {} }
    );

    console.log("Connecting to Python MCP Server...");
    await client.connect(transport);
    console.log("Connected Successfully! 🎉");

    // 1. Server ke tools list karna
    const tools = await client.listTools();
    console.log("\nAvailable Tools:", tools.tools.map(t => t.name));

    // Database check karne ka tool call karein
    console.log("\nCalling db_check_tables tool...");
    const result = await client.callTool({
        name: "db_check_tables",
        arguments: {}
    });
    console.log("Result from Python Server:", result.content[0].text);

    // 2. Dusra tool call karte hain: db_get_all_patients
    console.log("\nCalling db_get_all_patients tool...");
    const patientsResult = await client.callTool({
        name: "db_get_all_patients",
        arguments: {}
    });
    console.log("Patients Result:", patientsResult.content[0].text);

    // 3. API wala tool test karte hain (Make sure your Node.js server is running)
    console.log("\nCalling api_get_queue_status tool...");
    const queueResult = await client.callTool({
        name: "api_get_queue_status",
        arguments: {}
    });
    console.log("Queue API Result:", queueResult.content[0].text);

    // Agar server band karna ho
    await client.close();
}

connectToPythonServer().catch(console.error);
