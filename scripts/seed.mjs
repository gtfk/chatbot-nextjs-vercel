// scripts/seed.js (Corregido con sintaxis CommonJS)

// Importamos las librerías con require
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const pdf = require('pdf-parse');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const { HuggingFaceInferenceAPIEmbeddings } = require('@langchain/community/embeddings/hf');

// 1. Carga tus variables de entorno (desde los Secrets de Codespaces)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const hfToken = process.env.HUGGINGFACEHUB_API_TOKEN;

if (!supabaseUrl || !supabaseKey || !hfToken) {
  throw new Error(
    "Faltan secretos de Codespace. Asegúrate de que SUPABASE_URL, SUPABASE_KEY, y HUGGINGFACEHUB_API_TOKEN estén configurados."
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);
const embeddings = new HuggingFaceInferenceAPIEmbeddings({
  apiKey: hfToken,
  model: 'sentence-transformers/all-MiniLM-L6-v2',
});

// Usamos una función autoejecutable porque 'await' no es permitido
// en el nivel superior de un script CommonJS.
(async () => {
  console.log('Empezando el proceso de sembrado (seeding) del PDF...');
  
  // 1. Cargar el PDF
  const pdfData = await fs.readFile('reglamento.pdf');
  const data = await pdf(pdfData);
  
  console.log(`PDF cargado. ${data.numpages} páginas.`);

  // 2. Dividir el texto en trozos
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
  });
  const documents = await splitter.createDocuments([data.text]);
  console.log(`Texto dividido en ${documents.length} trozos.`);

  // 3. Generar embeddings y preparar los datos
  const documentsToInsert = [];
  for (const [index, doc] of documents.entries()) {
    const embedding = await embeddings.embedQuery(doc.pageContent);
    documentsToInsert.push({
      content: doc.pageContent,
      embedding: embedding,
    });
    console.log(`Generando embedding para el trozo ${index + 1} de ${documents.length}...`);
  }

  // 4. Limpiar la tabla antigua
  console.log('Borrando documentos antiguos de Supabase...');
  await supabase.from('documents').delete().neq('id', 0); // Borra todo

  // 5. Insertar los nuevos documentos en Supabase
  console.log('Insertando nuevos documentos en Supabase (esto puede tardar)...');
  for (let i = 0; i < documentsToInsert.length; i += 100) {
    const batch = documentsToInsert.slice(i, i + 100);
    const { error } = await supabase.from('documents').insert(batch);
    if (error) {
      console.error('Error insertando lote:', error);
    } else {
      console.log(`Lote ${Math.floor(i/100) + 1} insertado exitosamente.`);
    }
  }

  console.log('✅ ¡Sembrado completo! Tu PDF ahora está en la base de datos de Supabase.');
})();