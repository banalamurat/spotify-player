import axios from 'axios';
import express from 'express';
import querystring from 'querystring';
import WebSocket from 'ws';
import path = from 'path';
import open from 'open';

const CLIENT_ID = "08ca014eec2149b9bbdd6ba987aee6b1";
const CLIENT_SECRET = "d0dfe56257094788b0eb5aceb82e9491";
const REDIRECT_URI = 'http://localhost:8888/callback';
const PORT = 8888;
const POLL_INTERVAL = 1000; // Poll every 5 seconds

let currentTrack = null; // Store the currently playing track to detect changes
let currentTrackInfo = null; // Store current track info for WebSocket updates

const app = express();

// WebSocket setup
const wss = new WebSocket.Server({ noServer: true });

// When a WebSocket connection is established, listen for messages
wss.on('connection', (ws) => {
  console.log('WebSocket connection established.');

  // Send the current track info to the client
  if (currentTrackInfo) {
    ws.send(JSON.stringify(currentTrackInfo)); // Send the initial track info
  }

  // Send track updates every 5 seconds
  setInterval(() => {
    if (currentTrackInfo) {
      ws.send(JSON.stringify(currentTrackInfo)); // Send track info to client
    }
  }, POLL_INTERVAL);
});

// Handle WebSocket upgrade requests
app.server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  open("http://localhost:8888/login")
});

app.server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Step 1: Redirect user to Spotify's authorization page
app.get('/login', (req, res) => {
  const scope = 'user-read-playback-state user-read-currently-playing';
  const authURL = `https://accounts.spotify.com/authorize?${querystring.stringify({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: scope,
    redirect_uri: REDIRECT_URI,
  })}`;
  res.redirect(authURL);
});

// Step 2: Handle the callback and exchange the code for an access token
// Step 2: Handle the callback and exchange the code for an access token
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  
  try {
    const tokenResponse = await axios.post(
      'https://accounts.spotify.com/api/token',
      querystring.stringify({
        code: code,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
      {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const accessToken = tokenResponse.data.access_token;
    startPolling(accessToken); // Start polling for the currently playing track.

    // Redirect to /song after successful authorization
    res.redirect('/song');
  } catch (error) {
    res.status(500).send('Error during token exchange.');
    console.error(error);
  }
});

// Step 3: Use the access token to get the currently playing track
const getCurrentlyPlaying = async (accessToken) => {
  try {
    const response = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.data && response.data.item) {
      const track = response.data.item.name;
      const artist = response.data.item.artists[0].name;
      const albumArt = response.data.item.album.images[0].url; // Get the highest resolution image

      // Check if the track has changed
      if (currentTrack !== track) {
        currentTrack = track; // Update the current track
        currentTrackInfo = { track, artist, albumArt }; // Update current track info for WebSocket
        console.clear(); // Clear previous output
        console.log(`Currently Playing: "${track}" by ${artist}`);
        console.log(`Album Art: ${albumArt}`);
      }
    } else {
      console.log('No track currently playing.');
    }
  } catch (error) {
    console.error('Error fetching currently playing track:', error);
  }
};

// Step 4: Start polling for track updates
const startPolling = (accessToken) => {
  setInterval(() => {
    getCurrentlyPlaying(accessToken); // Check the currently playing track every 5 seconds
  }, POLL_INTERVAL);
};

// Redirect to /login automatically when visiting the homepage
app.get('/', (req, res) => {
  res.redirect('/login');
});

// Serve the HTML content for /song
app.get('/center', (req, res) => {
  const htmlContent = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Spotify Now Playing</title>
      <style>
          body {
              color: white;
              font-family: Arial, sans-serif;
              margin: 0;
              padding: 0;
              height: 100vh;
              background-color: transparent; /* Transparent background */
              display: flex;
              justify-content: center; /* Center horizontally */
              align-items: center; /* Center vertically */
          }
          .container {
              text-align: center; /* Align everything in the container to the center */
          }
          .album-art {
              width: 250px;
              height: 250px;
              margin-bottom: 20px;
              border-radius: 10px;
              transition: opacity 0.5s ease-in-out;
          }
          .track-info {
              font-size: 24px;
              font-weight: bold;
              text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8); /* Shadow for the track name */
              margin-bottom: 10px;
          }
          .artist-info {
              font-size: 20px;
              font-style: italic;
              text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8); /* Shadow for the artist name */
          }

          /* Animation for fade-out and fade-in transition */
          .fade-out {
              opacity: 0;
          }
          .fade-in {
              opacity: 1;
          }
      </style>
  </head>
  <body>
      <div class="container">
          <img id="album-art" class="album-art fade-in" src="" alt="Album Art">
          <div id="track-name" class="track-info">Track Name</div>
          <div id="artist-name" class="artist-info">Artist Name</div>
      </div>

      <script>
          let currentTrack = '';  // Track information to avoid unnecessary updates
          let currentAlbumArt = '';  // Album Art URL to track the last used image

          // Create a WebSocket to listen for changes in the track
          const socket = new WebSocket('ws://localhost:8888'); // WebSocket connection

          socket.onmessage = function(event) {
              const trackInfo = JSON.parse(event.data);

              if (trackInfo) {
                  const { track, artist, albumArt } = trackInfo;

                  // Check if the song and album art are different from the previous one
                  if (track !== currentTrack || albumArt !== currentAlbumArt) {
                      const albumArtElement = document.getElementById('album-art');

                      // If the album art is changing, apply a fade-out, then fade-in transition
                      albumArtElement.classList.remove('fade-in');
                      albumArtElement.classList.add('fade-out');

                      // After the fade-out transition, update the album art and text
                      setTimeout(() => {
                          document.getElementById('track-name').textContent = track;
                          document.getElementById('artist-name').textContent = artist;
                          albumArtElement.src = albumArt;

                          // Apply the fade-in effect after the image has changed
                          albumArtElement.classList.remove('fade-out');
                          albumArtElement.classList.add('fade-in');
                      }, 500); // Time for fade-out to complete before changing the image

                      // Update the current track and album art
                      currentTrack = track;
                      currentAlbumArt = albumArt;
                  }
              }
          };
      </script>
  </body>
  </html>
  `;


  res.send(htmlContent); // Send the HTML content as a response
});

app.get('/left', (req, res) => {
  const htmlContent = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Spotify Now Playing</title>
      <style>
          body {
              color: white;
              font-family: Arial, sans-serif;
              margin: 0;
              padding: 0;
              height: 100vh;
              background-color: transparent; /* Transparent background */
              display: flex;
              justify-content: flex-start; /* Align content to the left */
              align-items: center; /* Center vertically */
              padding-left: 20px; /* Add space to the left */
          }
          .container {
              text-align: left; /* Align everything in the container to the left */
          }
          .album-art {
              width: 250px;
              height: 250px;
              margin-bottom: 20px;
              border-radius: 10px;
              transition: opacity 0.5s ease-in-out;
          }
          .track-info {
              font-size: 24px;
              font-weight: bold;
              text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8); /* Shadow for the track name */
              margin-bottom: 10px;
          }
          .artist-info {
              font-size: 20px;
              font-style: italic;
              text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8); /* Shadow for the artist name */
          }

          /* Animation for fade-out and fade-in transition */
          .fade-out {
              opacity: 0;
          }
          .fade-in {
              opacity: 1;
          }
      </style>
  </head>
  <body>
      <div class="container">
          <img id="album-art" class="album-art fade-in" src="" alt="Album Art">
          <div id="track-name" class="track-info">Track Name</div>
          <div id="artist-name" class="artist-info">Artist Name</div>
      </div>

      <script>
          let currentTrack = '';  // Track information to avoid unnecessary updates
          let currentAlbumArt = '';  // Album Art URL to track the last used image

          // Create a WebSocket to listen for changes in the track
          const socket = new WebSocket('ws://localhost:8888'); // WebSocket connection

          socket.onmessage = function(event) {
              const trackInfo = JSON.parse(event.data);

              if (trackInfo) {
                  const { track, artist, albumArt } = trackInfo;

                  // Check if the song and album art are different from the previous one
                  if (track !== currentTrack || albumArt !== currentAlbumArt) {
                      const albumArtElement = document.getElementById('album-art');

                      // If the album art is changing, apply a fade-out, then fade-in transition
                      albumArtElement.classList.remove('fade-in');
                      albumArtElement.classList.add('fade-out');

                      // After the fade-out transition, update the album art and text
                      setTimeout(() => {
                          document.getElementById('track-name').textContent = track;
                          document.getElementById('artist-name').textContent = artist;
                          albumArtElement.src = albumArt;

                          // Apply the fade-in effect after the image has changed
                          albumArtElement.classList.remove('fade-out');
                          albumArtElement.classList.add('fade-in');
                      }, 500); // Time for fade-out to complete before changing the image

                      // Update the current track and album art
                      currentTrack = track;
                      currentAlbumArt = albumArt;
                  }
              }
          };
      </script>
  </body>
  </html>
  `;

  res.send(htmlContent); // Send the HTML content as a response
});

app.get('/right', (req, res) => {
  const htmlContent = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Spotify Now Playing</title>
      <style>
          body {
              color: white;
              font-family: Arial, sans-serif;
              margin: 0;
              padding: 0;
              height: 100vh;
              background-color: transparent; /* Transparent background */
              display: flex;
              justify-content: flex-end; /* Align content to the right */
              align-items: center; /* Center vertically */
              padding-right: 20px; /* Add space to the right */
          }
          .container {
              text-align: right; /* Align everything in the container to the right */
          }
          .album-art {
              width: 250px;
              height: 250px;
              margin-bottom: 20px;
              border-radius: 10px;
              transition: opacity 0.5s ease-in-out;
          }
          .track-info {
              font-size: 24px;
              font-weight: bold;
              text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8); /* Shadow for the track name */
              margin-bottom: 10px;
          }
          .artist-info {
              font-size: 20px;
              font-style: italic;
              text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8); /* Shadow for the artist name */
          }

          /* Animation for fade-out and fade-in transition */
          .fade-out {
              opacity: 0;
          }
          .fade-in {
              opacity: 1;
          }
      </style>
  </head>
  <body>
      <div class="container">
          <img id="album-art" class="album-art fade-in" src="" alt="Album Art">
          <div id="track-name" class="track-info">Track Name</div>
          <div id="artist-name" class="artist-info">Artist Name</div>
      </div>

      <script>
          let currentTrack = '';  // Track information to avoid unnecessary updates
          let currentAlbumArt = '';  // Album Art URL to track the last used image

          // Create a WebSocket to listen for changes in the track
          const socket = new WebSocket('ws://localhost:8888'); // WebSocket connection

          socket.onmessage = function(event) {
              const trackInfo = JSON.parse(event.data);

              if (trackInfo) {
                  const { track, artist, albumArt } = trackInfo;

                  // Check if the song and album art are different from the previous one
                  if (track !== currentTrack || albumArt !== currentAlbumArt) {
                      const albumArtElement = document.getElementById('album-art');

                      // If the album art is changing, apply a fade-out, then fade-in transition
                      albumArtElement.classList.remove('fade-in');
                      albumArtElement.classList.add('fade-out');

                      // After the fade-out transition, update the album art and text
                      setTimeout(() => {
                          document.getElementById('track-name').textContent = track;
                          document.getElementById('artist-name').textContent = artist;
                          albumArtElement.src = albumArt;

                          // Apply the fade-in effect after the image has changed
                          albumArtElement.classList.remove('fade-out');
                          albumArtElement.classList.add('fade-in');
                      }, 500); // Time for fade-out to complete before changing the image

                      // Update the current track and album art
                      currentTrack = track;
                      currentAlbumArt = albumArt;
                  }
              }
          };
      </script>
  </body>
  </html>
  `;

  res.send(htmlContent); // Send the HTML content as a response
});

app.get('/small', (req, res) => {
  const htmlContent = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Spotify Now Playing</title>
      <style>
          body {
              color: white;
              font-family: Arial, sans-serif;
              margin: 0;
              padding: 0;
              height: 100vh;
              background-color: transparent;
              display: flex;
              justify-content: left; /* Align content to the right */
              align-items: center; /* Center vertically */
              padding-right: 20px; /* Add space to the right */
          }

          .container {
              display: flex;
              align-items: center; /* Align text and album art horizontally */
              text-align: left;
          }
          .album-art {
              width: 100px; /* Smaller album art */
              height: 100px; /* Smaller album art */
              margin-right: 20px; /* Space between album art and text */
              border-radius: 10px;
              transition: opacity 0.5s ease-in-out;
          }
          .track-info {
              font-size: 18px; /* Smaller font size */
              font-weight: bold;
              text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
              margin-bottom: 5px;
          }
          .artist-info {
              font-size: 16px; /* Smaller font size */
              font-style: italic;
              text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
          }

          /* Animation for fade-out and fade-in transition */
          .fade-out {
              opacity: 0;
          }
          .fade-in {
              opacity: 1;
          }
      </style>
  </head>
  <body>
      <div class="container">
          <img id="album-art" class="album-art fade-in" src="" alt="Album Art">
          <div>
              <div id="track-name" class="track-info">Track Name</div>
              <div id="artist-name" class="artist-info">Artist Name</div>
          </div>
      </div>

      <script>
          let currentTrack = '';  // Track information to avoid unnecessary updates
          let currentAlbumArt = '';  // Album Art URL to track the last used image

          // Create a WebSocket to listen for changes in the track
          const socket = new WebSocket('ws://localhost:8888'); // WebSocket connection

          socket.onmessage = function(event) {
              const trackInfo = JSON.parse(event.data);

              if (trackInfo) {
                  const { track, artist, albumArt } = trackInfo;

                  // Check if the song and album art are different from the previous one
                  if (track !== currentTrack || albumArt !== currentAlbumArt) {
                      const albumArtElement = document.getElementById('album-art');

                      // If the album art is changing, apply a fade-out, then fade-in transition
                      albumArtElement.classList.remove('fade-in');
                      albumArtElement.classList.add('fade-out');

                      // After the fade-out transition, update the album art and text
                      setTimeout(() => {
                          document.getElementById('track-name').textContent = track;
                          document.getElementById('artist-name').textContent = artist;
                          albumArtElement.src = albumArt;

                          // Apply the fade-in effect after the image has changed
                          albumArtElement.classList.remove('fade-out');
                          albumArtElement.classList.add('fade-in');
                      }, 500); // Time for fade-out to complete before changing the image

                      // Update the current track and album art
                      currentTrack = track;
                      currentAlbumArt = albumArt;
                  }
              }
          };
      </script>
  </body>
  </html>
  `;

  res.send(htmlContent); // Send the HTML content as a response
});

app.get('/small-right', (req, res) => {
  const htmlContent = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Spotify Now Playing</title>
      <style>
          body {
              color: white;
              font-family: Arial, sans-serif;
              margin: 0;
              padding: 0;
              height: 100vh;
              background-color: transparent;
              display: flex;
              justify-content: flex-end; /* Align content to the right */
              align-items: center; /* Center vertically */
              padding-right: 20px; /* Add space to the right */
          }
          .container {
              display: flex;
              align-items: center; /* Align text and album art horizontally */
              text-align: left;
          }
          .album-art {
              width: 100px; /* Smaller album art */
              height: 100px; /* Smaller album art */
              margin-left: 20px; /* Space between text and album art */
              border-radius: 10px;
              transition: opacity 0.5s ease-in-out;
          }
          .track-info {
              font-size: 18px; /* Smaller font size */
              font-weight: bold;
              text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
              margin-bottom: 5px;
          }
          .artist-info {
              font-size: 16px; /* Smaller font size */
              font-style: italic;
              text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
          }

          /* Animation for fade-out and fade-in transition */
          .fade-out {
              opacity: 0;
          }
          .fade-in {
              opacity: 1;
          }
      </style>
  </head>
  <body>
      <div class="container">
          <div>
              <div id="track-name" class="track-info">Track Name</div>
              <div id="artist-name" class="artist-info">Artist Name</div>
          </div>
          <img id="album-art" class="album-art fade-in" src="" alt="Album Art">
      </div>

      <script>
          let currentTrack = '';  // Track information to avoid unnecessary updates
          let currentAlbumArt = '';  // Album Art URL to track the last used image

          // Create a WebSocket to listen for changes in the track
          const socket = new WebSocket('ws://localhost:8888'); // WebSocket connection

          socket.onmessage = function(event) {
              const trackInfo = JSON.parse(event.data);

              if (trackInfo) {
                  const { track, artist, albumArt } = trackInfo;

                  // Check if the song and album art are different from the previous one
                  if (track !== currentTrack || albumArt !== currentAlbumArt) {
                      const albumArtElement = document.getElementById('album-art');

                      // If the album art is changing, apply a fade-out, then fade-in transition
                      albumArtElement.classList.remove('fade-in');
                      albumArtElement.classList.add('fade-out');

                      // After the fade-out transition, update the album art and text
                      setTimeout(() => {
                          document.getElementById('track-name').textContent = track;
                          document.getElementById('artist-name').textContent = artist;
                          albumArtElement.src = albumArt;

                          // Apply the fade-in effect after the image has changed
                          albumArtElement.classList.remove('fade-out');
                          albumArtElement.classList.add('fade-in');
                      }, 500); // Time for fade-out to complete before changing the image

                      // Update the current track and album art
                      currentTrack = track;
                      currentAlbumArt = albumArt;
                  }
              }
          };
      </script>
  </body>
  </html>
  `;

  res.send(htmlContent); // Send the HTML content as a response
});


app.get('/song', (req, res) => {
  const htmlContent = `
<title>anzeige-auswahl</title>
<script>
    function copyToClipboard(url) {
      // Create a temporary input element to copy the URL
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      
    }
  </script>
<h1>auswahl</h1>
<hr>
<body>
  <div>
    <a href="http://localhost:8888/left" target="_blank">/left</a>	
    <button onclick="copyToClipboard('http://localhost:8888/left')">	kopier link für obs</button>
  </div>
  <div>
    <a href="http://localhost:8888/right" target="_blank">/right</a>	
    <button onclick="copyToClipboard('http://localhost:8888/right')">	kopier link für obs</button>
  </div>
  <div>
    <a href="http://localhost:8888/small" target="_blank">/small</a>	
    <button onclick="copyToClipboard('http://localhost:8888/small')">	kopier link für obs</button>
  </div>
 <div>
    <a href="http://localhost:8888/center" target="_blank">/center</a>	
    <button onclick="copyToClipboard('http://localhost:8888/center')">	kopier link für obs</button>
  </div>
<div>
    <a href="http://localhost:8888/small-right" target="_blank">/small-right</a>	
    <button onclick="copyToClipboard('http://localhost:8888/small-right')">	kopier link für obs</button>
  </div>

</body>
`
res.send(htmlContent);
});
