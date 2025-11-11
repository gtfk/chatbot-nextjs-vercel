// scripts/seed.js (Versión Nativa de Supabase - Corregida)

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const pdf = require('pdf-parse');
// Importamos la herramienta de texto que SÍ está en el package.json
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');

// 1. Carga tus variables de entorno (¡YA NO NECESITAMOS HF_TOKEN!)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Faltan secretos de Codespace. Asegúrate de que SUPABASE_URL y SUPABASE_KEY estén configurados."
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

// --- 2. FUNCIÓN PARA GENERAR EMBEDDINGS USANDO SUPABASE ---
async function getEmbedding(text) {
  try {
    // Llama a la Edge Function 'embed' que creamos
    const { data, error } = await supabase.functions.invoke('embed', {
      body: { text: text },
    });
    if (error) throw new Error(error.message);
    return data.embedding;
  } catch (error) {
    console.error(`Error al generar embedding: ${error.message}. Reintentando...`);
    // Si falla (ej. por timeout de Supabase), reintentamos una vez.
    await new Promise(resolve => setTimeout(resolve, 1000));
    const { data, error: error2 } = await supabase.functions.invoke('embed', {
      body: { text: text },
    });
    if (error2) throw new Error(error2.message);
    return data.embedding;
  }
}

// --- 3. SCRIPT PRINCIPAL ---
(async () => {
  try {
    console.log('Empezando el proceso de sembrado (seeding) del PDF...');
    
    // Cargar el PDF (asegúrate que se llame 'reglamento.pdf')
    const pdfData = await fs.readFile('reglamento.pdf');
    const data = await pdf(pdfData);
    
    console.log(`PDF cargado. ${data.numpages} páginas.`);

    // Dividir el texto en trozos
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 500,
      chunkOverlap: 50,
    });
    const documents = await splitter.createDocuments([data.text]);
    console.log(`Texto dividido en ${documents.length} trozos.`);

    // Limpiar la tabla antigua
    console.log('Borrando documentos antiguos de Supabase...');
    await supabase.from('documents').delete().neq('id', 0); // Borra todo

    // Generar embeddings (¡llamando a Supabase!) y guardar
    console.log('Generando embeddings y guardando en Supabase (esto puede tardar)...');
    
    for (const [index, doc] of documents.entries()) {
      // 4a. Generar el embedding llamando a la función de Supabase
      const embedding = await getEmbedding(doc.pageContent);
      
      // 4b. Insertar el contenido y el embedding
      const { error } = await supabase.from('documents').insert({
        content: doc.pageContent,
        embedding: embedding,
      });
      
      if (error) {
        console.error(`Error insertando trozo ${index + 1}:`, error.message);
      } else {
        console.log(`Trozo ${index + 1}/${documents.length} guardado.`);
      }
      
      // Pausa pequeña para no saturar la API de funciones de Supabase
      await new Promise(resolve => setTimeout(resolve, 100)); 
    }

    console.log('✅ ¡Sembrado completo! Tu PDF ahora está en la base de datos de Supabase.');
  } catch (err) {
    console.error("\nError fatal durante el sembrado:", err);
  }
})();