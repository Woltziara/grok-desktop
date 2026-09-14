// Only the shell is a fixture; the transfer UI and IPC are production modules.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {WorkingKnowledgeTransfer} from '../../src/components/WorkingKnowledgeTransfer';
createRoot(document.getElementById('root')!).render(<WorkingKnowledgeTransfer objectId="sample"/>);
