import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { logger } from '../utils/logger.js';
import open from 'open';

const MIME_CSV = 'text/csv';
const MIME_SHEETS = 'application/vnd.google-apps.spreadsheet';
const SCOPES = ['https://www.googleapis.com/auth/drive'];
const TOKEN_PATH = './credentials/token.json';
const CREDENTIALS_PATH = './credentials/oauth-client.json';
const REDIRECT_PORT = 3000;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `No se encontró el archivo de credenciales OAuth2 en: ${CREDENTIALS_PATH}\n` +
        'Sigue las instrucciones del README para configurar Google Drive.'
    );
  }
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  const creds = raw.installed || raw.web;
  if (!creds) throw new Error('Formato de credenciales inválido.');
  return creds;
}

function createOAuthClient() {
  const { client_id, client_secret } = loadCredentials();
  return new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);
}

async function authorizeViaBrowser(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('\n🌐 Abriendo navegador para autorizar acceso a Google Drive...\n');
  await open(authUrl);

  // Servidor local temporal para capturar el código de autorización
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      const code = url.searchParams.get('code');
      if (code) {
        res.end('<h2>Autorización completada. Puedes cerrar esta pestaña.</h2>');
        server.close();
        resolve(code);
      } else {
        res.end('<h2>Error: no se recibió código de autorización.</h2>');
        server.close();
        reject(new Error('No se recibió código de autorización'));
      }
    });

    server.listen(REDIRECT_PORT, () => {
      logger.debug(`Esperando autorización en ${REDIRECT_URI}...`);
    });

    server.on('error', reject);
  });

  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);

  // Guardar token para futuras ejecuciones
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  logger.debug('Token guardado en credentials/token.json');

  return oAuth2Client;
}

async function getAuthClient() {
  const oAuth2Client = createOAuthClient();

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oAuth2Client.setCredentials(token);

    // Refrescar si está expirado
    if (token.expiry_date && token.expiry_date < Date.now()) {
      logger.debug('Token expirado, refrescando...');
      const { credentials } = await oAuth2Client.refreshAccessToken();
      oAuth2Client.setCredentials(credentials);
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials, null, 2));
    }

    return oAuth2Client;
  }

  return authorizeViaBrowser(oAuth2Client);
}

async function findFileInFolder(drive, fileName, folderId) {
  const res = await drive.files.list({
    q: `name='${fileName}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });
  return res.data.files.length > 0 ? res.data.files[0].id : null;
}

/**
 * Sube o actualiza un CSV en Google Drive como Google Sheets.
 * @param {string} csvPath - Ruta local del CSV
 * @param {string} folderId - ID de la carpeta de Google Drive
 * @returns {Promise<{id: string, name: string, url: string}>}
 */
export async function uploadCSV(csvPath, folderId) {
  const auth = await getAuthClient();
  const drive = google.drive({ version: 'v3', auth });

  const fileName = path.basename(csvPath, '.csv');
  const existingId = await findFileInFolder(drive, fileName, folderId);

  let fileId;

  if (existingId) {
    logger.debug(`Actualizando archivo existente: ${fileName}`);
    const res = await drive.files.update({
      fileId: existingId,
      media: { mimeType: MIME_CSV, body: fs.createReadStream(csvPath) },
      fields: 'id',
    });
    fileId = res.data.id;
  } else {
    logger.debug(`Creando nuevo archivo: ${fileName}`);
    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType: MIME_SHEETS,
        parents: [folderId],
      },
      media: { mimeType: MIME_CSV, body: fs.createReadStream(csvPath) },
      fields: 'id',
    });
    fileId = res.data.id;
  }

  const file = await drive.files.get({ fileId, fields: 'id, name, webViewLink' });
  return { id: file.data.id, name: file.data.name, url: file.data.webViewLink };
}

export default { uploadCSV };
