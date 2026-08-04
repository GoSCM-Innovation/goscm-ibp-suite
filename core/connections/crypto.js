// Cifrado de las contraseñas de los usuarios de comunicación de SAP.
//
// Es la deuda más grave que arrastraban las apps viejas: v8 guardaba las contraseñas de SAP
// **en texto plano en el navegador**. Aquí viven cifradas en la base de datos y solo el
// servidor las descifra, justo antes de usarlas. Nunca se envían al navegador, ni siquiera al
// administrador que las escribió.
//
// Se usa AES-256-GCM, que además de cifrar AUTENTICA: si alguien altera el texto cifrado, el
// descifrado falla en vez de devolver basura silenciosamente.
//
// Y se ata cada secreto a su sitio. El dato asociado incluye el cliente, la conexión y el
// acuerdo, así que un texto cifrado copiado a otra fila —por ejemplo, moviendo el secreto de
// un cliente a la conexión de otro— no descifra. Sin esta atadura, quien pudiera escribir en
// la base podría reutilizar secretos ajenos sin conocerlos.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32

function encryptionKey() {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'Falta CREDENTIALS_ENCRYPTION_KEY: no se pueden guardar ni leer las contraseñas de SAP.',
    )
  }
  const key = Buffer.from(raw, 'hex')
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `CREDENTIALS_ENCRYPTION_KEY debe ser de ${KEY_BYTES} bytes en hexadecimal ` +
      `(${KEY_BYTES * 2} caracteres). Generar con: npm run gen:secret`,
    )
  }
  return key
}

/** El contexto que ata un secreto a su fila. Cambiar cualquiera de las tres partes lo invalida. */
function contextFor({ clientId, connectionId, agreement }) {
  if (!clientId || !connectionId || !agreement) {
    throw new Error('El cifrado de credenciales necesita cliente, conexión y acuerdo.')
  }
  return Buffer.from(`${clientId}:${connectionId}:${agreement}`, 'utf8')
}

/** Cifra una contraseña. Devuelve las tres partes que van a la base de datos. */
export function encryptSecret(plaintext, context) {
  if (typeof plaintext !== 'string' || plaintext === '') {
    throw new Error('No se puede cifrar una contraseña vacía.')
  }
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv)
  cipher.setAAD(contextFor(context))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
}

/**
 * Descifra una contraseña. Revienta si el texto cifrado fue alterado, si la clave no es la
 * que se usó, o si el secreto pertenece a otra fila.
 */
export function decryptSecret({ ciphertext, iv, tag }, context) {
  if (!ciphertext || !iv || !tag) throw new Error('Faltan partes del secreto cifrado.')

  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(iv, 'base64'))
  decipher.setAAD(contextFor(context))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    // El mensaje no dice nada del secreto ni de la clave a propósito.
    throw new Error('No se pudo descifrar la contraseña de SAP: el secreto no es válido para esta conexión.')
  }
}
