/**
 * Fil de calcul de l'import (module AK.2) : l'interface ne gele pas pendant
 * la lecture d'un fichier de 200 000 facettes, sa reparation et sa mesure.
 */

import { handleImportRequest, type ImportReply, type ImportRequest } from './importTasks';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ImportRequest>) => void) | null;
  postMessage: (message: ImportReply) => void;
};

scope.onmessage = (event) => handleImportRequest(event.data, (reply) => scope.postMessage(reply));
