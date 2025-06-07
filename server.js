const express = require("express");
const http = require("http");
const WebSocket = require("ws");

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({ server });
app.use(express.json());

// In-memory storage for users and messages
const users = [];
const messages = [];
let userIdCounter = 1;
let messageIdCounter = 1;

// Store WebSocket connections
const wsConnections = new Map();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.post("/api/user", (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Name is required" });
  }

  // Check if name already exists
  const existingUser = users.find(user => user.name === name);
  if (existingUser) {
    return res.status(200).json({
      message: "Name already exists",
      user: existingUser,
    });
  }

  const newUser = {
    id: userIdCounter++,
    name,
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);
  res.status(201).json({
    message: "User added successfully",
    user: newUser,
  });
});

// WebSocket connection handling for chat
wss.on("connection", (ws, req) => {
  console.log("New WebSocket connection established");

  let connectedUserId = null;

  // Handle incoming messages
  ws.on("message", data => {
    try {
      const message = JSON.parse(data);
      console.log("Received WebSocket message:", message);

      switch (message.type) {
        case "USER_LIST":
          const userId = parseInt(message.data.userId);
          connectedUserId = userId;
          wsConnections.set(userId, ws);

          // Update all online users
          wsConnections.forEach((connection, key) => {
            if (connection.readyState === WebSocket.OPEN) {
              connection.send(JSON.stringify({ type: "USER_LIST", users: users.filter(user => user.id !== key) }));
            }
          });
          break;

        case "CHAT_HISTORY":
          const senderId = parseInt(message.data.senderId);
          const recipientId = parseInt(message.data.recipientId);
          const chatMessages = getChatHistory(senderId, recipientId);

          ws.send(
            JSON.stringify({
              type: "CHAT_HISTORY",
              messages: chatMessages,
            }),
          );

          break;

        case "SEND_MESSAGE":
          const messageData = message.data;

          // Create new message object.
          const newMessage = {
            id: messageIdCounter++,
            senderId: messageData?.senderId,
            senderName: messageData?.senderName,
            recipientId: messageData?.recipientId,
            recipientName: messageData?.recipientName,
            message: messageData?.message?.trim(),
            timestamp: new Date().toISOString(),
          };

          // Store message
          messages.push(newMessage);

          // Send confirmation to sender
          ws.send(
            JSON.stringify({
              type: "SEND_MESSAGE",
              message: newMessage,
            }),
          );

          // Send message to recipient if online
          const recipientWs = wsConnections.get(message.data.recipientId);
          if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
            recipientWs.send(
              JSON.stringify({
                type: "NEW_MESSAGE",
                message: newMessage,
              }),
            );
          }
          break;

        default:
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Unknown message type.",
            }),
          );
      }
    } catch (error) {
      console.error("Error parsing WebSocket message:", error);
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Invalid message",
        }),
      );
    }
  });

  // Handle connection close
  ws.on("close", () => {
    console.log("WebSocket connection closed");
    if (connectedUserId) {
      wsConnections.delete(connectedUserId);
    }
  });

  // Handle errors
  ws.on("error", error => {
    console.error("WebSocket error:", error);
    if (connectedUserId) {
      wsConnections.delete(connectedUserId);
    }
  });
});

// Get Chat History between two users.
function getChatHistory(userId1, userId2) {
  const conversation = messages.filter(msg => (msg.senderId === userId1 && msg.recipientId === userId2) || (msg.senderId === userId2 && msg.recipientId === userId1));
  return conversation.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

// Start server
const PORT = 9000;
server.listen(PORT, () => {
  console.log(`Chat Server is running on http://localhost:${PORT}`);
});

process.on("SIGINT", () => {
  console.log("\nShutting down gracefully...");
  // Close all active WebSocket connections here
  wss.clients.forEach(client => client.close());

  wss.close(() => {
    console.log("WebSocket server closed.");
    // Close the main HTTP server
    server.close(() => {
      console.log("HTTP server closed.");
      process.exit(0);
    });
  });
});
