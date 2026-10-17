# Guía de uso de BioCiencia

*La ciencia conectada, el conocimiento compartido.*

BioCiencia es una aplicación para buscar, organizar, analizar y escribir investigación científica. Sus datos se guardan **en su computadora**; no hay un servidor central ni cuentas.

---

## 1. Instalar y abrir

### Con el instalador (recomendado)
1. Doble clic en **`BioCiencia-1.2.0-instalador.exe`**.
2. Windows puede mostrar «Windows protegió su PC» porque el instalador no tiene firma digital comercial: pulse **«Más información» → «Ejecutar de todas formas»**.
3. Siga los pasos (acepte la licencia libre MIT). Se instala solo para su usuario, sin permisos de administrador, en `%LOCALAPPDATA%\Programs\BioCiencia`.
4. Abra **BioCiencia** desde el escritorio o el menú Inicio. Se abre en su navegador en `http://127.0.0.1:5173/` (la misma dirección de antes: sus datos siguen ahí si usa el mismo navegador).
- No necesita Node.js ni ventana negra. Mientras está abierta, su **ícono aparece junto al reloj**: clic para abrirla, clic derecho → **Salir** para cerrarla.
- «BioCiencia (ventana propia)» la abre en una ventana de Microsoft Edge sin pestañas. Cada navegador guarda sus propios datos: use siempre el mismo o pase los datos con una copia de seguridad.
- Si aparece «El puerto 5173 está ocupado», cierre la ventana negra de «Iniciar BioCiencia.cmd» (o `npm run dev:web`) y vuelva a abrirla.
- **Actualizar:** ejecute el instalador nuevo encima; sus datos no se tocan. **Desinstalar:** Configuración de Windows → Aplicaciones → BioCiencia (sus datos quedan en el navegador).

### Sin instalar (para desarrollar)
Con Node.js 22 o más reciente y la carpeta del proyecto en `C:\BioCiencia`: doble clic en **«Iniciar BioCiencia.cmd»** (deje abierta la ventana negra) o, en Windows PowerShell:
```
cd C:\BioCiencia
npm.cmd install
npm.cmd run app
```

### Problemas frecuentes
| Mensaje | Solución |
| --- | --- |
| «Windows protegió su PC» | «Más información» → «Ejecutar de todas formas» (el instalador es libre y sin firma comercial) |
| `Could not read package.json … C:\Users\…` | No está en la carpeta del proyecto: `cd C:\BioCiencia` |
| `npm.ps1 no se puede cargar` | Use `npm.cmd` en lugar de `npm` |
| `Failed to resolve import "@biociencia/…"` | Falta `npm.cmd install` después de actualizar |
| La página no abre | Revise que el ícono de BioCiencia esté junto al reloj (o que la ventana negra siga abierta) |

---

## 2. Primer uso
1. Escriba su nombre y pulse «Crear identidad y entrar».
2. En **Configuración**, escriba su correo de contacto (las bases de datos gratuitas lo piden para identificar a quien consulta; no se publica).
3. Si su institución tiene biblioteca con suscripciones, pegue la dirección del proxy de biblioteca: aparecerá «Acceso institucional» en cada artículo.

---

## 3. Buscador
- Escriba una pregunta, palabras clave o un DOI. Por defecto busca **gratis** en Europe PMC, PubMed, Crossref y DOAJ a la vez y une los repetidos. Puede marcar además otras fuentes gratuitas: **arXiv** (preprints de física, matemáticas, informática y biología), **OpenAIRE** (repositorios y tesis de todo el mundo) y **Semantic Scholar** (citas y resúmenes; su servicio gratuito a veces pide esperar). OpenAlex es opcional (tiene costo por consulta).
- arXiv y Semantic Scholar **no permiten que el navegador lea sus respuestas** (por seguridad de esos servicios). El programa las consulta desde su propia computadora, así que funcionan al abrirlo con «Iniciar BioCiencia»; si se abre en modo desarrollo, esas dos le avisarán de que no pudieron responder. OpenAIRE, en cambio, funciona siempre.
- **Filtros**: años, solo acceso abierto, **tipo de estudio** (metaanálisis, revisión sistemática, ensayo aleatorizado, observacional…) y **método** (ensayo de campo, invernadero, in vitro, molecular, encuesta, modelación, drones). Tipo de estudio y método solo funcionan en PubMed y Europe PMC; las demás fuentes se omiten mientras estén activos.
- **Mejor evidencia primero**: reordena los resultados poniendo arriba metaanálisis, revisiones sistemáticas y experimentos controlados.
- **🔔 Seguir esta búsqueda**: en Inicio («Novedades de sus búsquedas» → «Revisar ahora») verá solo las publicaciones nuevas que aparezcan después sobre su tema.
- En cada resultado:
  - **Insignias de calidad**: «Evidencia: …» (nivel 1 metaanálisis … 6 opinión; según el tipo de publicación de PubMed o, si no hay, el título y el resumen) y «★ Muy citado» (el 10 % con más citas por año entre los resultados).
  - **⚠ Aviso de retractación**: si el artículo fue retractado, retirado, tiene aviso de preocupación o corrección (Retraction Watch vía Crossref, y PubMed), con el enlace al aviso.
  - **Ficha del estudio**: muestra, diseño, ámbito (campo, invernadero, laboratorio), lugar, organismos, duración y hallazgo principal, sacados del resumen **sin IA**; «¿de dónde?» muestra la frase exacta de la que salió cada dato.
  - **Resumen**: se ven las primeras líneas; «Leer resumen completo» lo abre entero. Si la base de datos no trajo el resumen, «Buscar resumen» lo pide a Europe PMC y Crossref y lo guarda en su biblioteca. Algunos artículos no tienen resumen público: en ese caso se avisa.
  - **¿Dónde leerlo?**: copias legales gratuitas (Unpaywall), acceso institucional y solicitarlo al autor.
  - **Solicitar artículo completo** (en los artículos que no son de acceso abierto): prepara una **carta muy formal** al autor, en español, inglés o ambos, con la referencia completa en APA, el motivo, el compromiso de uso académico y su firma (grado, cargo, institución, correo y ORCID; se recuerdan para la próxima vez). Si Europe PMC publica el correo del autor, aparece solo; si no, use «Buscar correo del autor» o búsquelo en la página del artículo. Puede abrirla en su correo, copiarla o descargarla en Word. BioCiencia no envía nada por su cuenta.
  - **Descargar cita** en BibTeX, RIS, EndNote, CSV o CSL-JSON, o como **referencia con estilo de revista**.
  - **Red de citas**: quién citó el artículo y qué artículos cita; puede seguir el rastro varios niveles («bola de nieve»).
  - **Guardar en biblioteca** o en un proyecto.

> BioCiencia no se conecta a Sci-Hub ni a fuentes no autorizadas. Para textos completos usa solo vías legales.

---

## 4. Biblioteca
- Busca dentro de sus publicaciones (sin tildes ni mayúsculas), con favoritos, etiquetas, colecciones y notas.
- **Importar** archivos de Zotero, Mendeley o EndNote (RIS, BibTeX, EndNote); no duplica lo que ya tiene.
- **Exportar** lo que está viendo en 6 formatos.
- «Es mía» marca una publicación como propia.
- **Revisar retracciones**: comprueba toda su biblioteca contra Retraction Watch (vía Crossref) y PubMed y marca los artículos retractados, retirados o corregidos.
- **Bibliografía de esta vista**: la lista de referencias con el estilo que elija (ver sección 7).
- **Grupos inteligentes** (botón «Grupo inteligente»): colecciones que se llenan solas según reglas, por ejemplo «Año desde 2020 **y** título contiene Trichoderma **y** tiene PDF». Reglas posibles: cualquier campo, título, autor, revista, resumen, palabra clave, observaciones, año, tipo, etiqueta, colección, fuente, acceso abierto, favorito, propia, tiene PDF, tiene DOI «añadida en los últimos N días», **nivel de evidencia** y **retractada**. Use «todas las reglas» (Y) o «al menos una» (O). Las publicaciones nuevas que cumplen las reglas aparecen solas.

---

## 5. Revisión de literatura (con diagrama PRISMA)
1. **Nueva revisión** → título.
2. **Pregunta y búsqueda**: escriba la pregunta; elija PICO, PEO o conceptos libres; escriba los sinónimos de cada concepto **en inglés, uno por línea** (use `*` para variantes: `resist*`). BioCiencia arma la estrategia para PubMed y Europe PMC (se ve en pantalla) y la ejecuta.
3. **Cribado**: lea título y resumen; «Incluir» o «Excluir» con el motivo.
4. **Resultados**: diagrama PRISMA 2020, texto de la estrategia para su sección de métodos, informe Word y lista de incluidos (para Zotero/EndNote o para su biblioteca y proyecto).

Si repite la búsqueda más tarde, sus decisiones anteriores se conservan.

---

## 6. Proyectos y colaboración
- Cree proyectos con objetivos, publicaciones y notas.
- **Compartir** con colegas: cada persona copia su **código de investigador** (Sincronización) y el administrador lo agrega con un rol (administrador, editor, lector).
- **Sincronización** entre computadoras: elija una carpeta compartida (Syncthing, una carpeta de red o una memoria USB). Cada cambio va firmado; nadie puede hacerse pasar por otro ni apropiarse del proyecto. En la versión web se usa «paquete manual» (exportar / importar archivo). Detalles: `docs/SINCRONIZACION.md`.

---

## 7. PDF, subrayados y estilos de cita
### PDF de cada publicación
- En la Biblioteca, **«Adjuntar PDF»** (o «PDF (n)») → «Elegir PDF…» o arrastre el archivo. Queda guardado en su computadora (máximo 80 MB por archivo). Use solo PDF que tenga derecho a guardar (acceso abierto, de su biblioteca institucional o enviados por el autor).
- **Leer y subrayar**: seleccione texto con el ratón y elija «Subrayar» o «Subrayar y anotar». Hay cuatro colores; cada subrayado puede llevar una nota. Las flechas ← → cambian de página.
- «Buscar en el PDF» indica en qué páginas aparece una palabra.
- «Copiar todo» copia los subrayados con su página; «Pasar a observaciones» los guarda en las observaciones de la publicación.
- El **texto del PDF** se puede buscar desde la Biblioteca (sin internet) y el **Análisis con IA** lo usa: además del resumen, recibe los pasajes del PDF más relacionados con la pregunta, y las frases citadas se verifican contra ese texto.
- Los PDF escaneados como imagen no tienen texto: se pueden leer, pero no subrayar ni buscar (no hay reconocimiento de texto, OCR).

### Bibliografía con estilos de revista (CSL)
- Botones **«Bibliografía de esta vista»** (Biblioteca), **«Bibliografía con estilo»** (Proyectos) y «Descargar cita → Referencia con estilo de revista» (una publicación).
- Hay **10 865 estilos** del repositorio oficial Citation Style Language: revistas (Plant Disease, Phytopathology, Agronomy Journal, Scientia Horticulturae, Frontiers, MDPI…), editoriales (Elsevier, Springer, Taylor & Francis…) y normas (APA 7, Vancouver, IEEE, Chicago, Harvard, ISO 690, ABNT…). Unos 4 800 funcionan sin internet; los demás se descargan una vez al elegirlos y quedan guardados.
- Elija el idioma (español, inglés, portugués…) para «y», «et al.», «en», etc.
- **Copiar** (al pegar en Word conserva las cursivas), **Descargar Word** o **texto**. También muestra la cita en el texto, p. ej. «(Flett & McLaren, 1998)».
- Si la revista no está, descargue su archivo `.csl` (desde la revista o https://www.zotero.org/styles) e «Importar estilo (.csl)».
- Límite: los nombres de revista van completos (aún no hay lista de abreviaturas). Si a una publicación le faltan datos (volumen, páginas), la referencia también saldrá incompleta: complételos con «Etiquetas, notas y proyecto» o vuelva a importarla.

---

## 8. Estadística
Pegue su tabla desde Excel (una fila por unidad experimental, encabezados en la primera fila). Análisis: descriptiva, t de Student (independiente y pareada), ANOVA DCA, DBCA y factorial con Tukey y letras, supuestos (Shapiro-Wilk, Levene), Kruskal-Wallis, correlación y regresión, χ². Resultados verificados contra SciPy y statsmodels; exporte a CSV.

---

## 9. Investigadores: ORCID, citas e índice h
- Escriba su ORCID y pulse «Importar mis publicaciones»: se traen las públicas de orcid.org y se completan con Crossref.
- **Citas**: pulse «Calcular citas e índices» para ver citas, índice h e índice i10 (todas y últimos 5 años) y un gráfico por año, con datos abiertos (OpenCitations, Europe PMC). Suelen ser **menos** que en Google Académico, que cuenta también tesis e informes y no tiene una conexión pública.
- **Scopus (opcional)**: con una clave personal gratuita de dev.elsevier.com, cada artículo muestra el recuadro oficial de citas en Scopus. Con su Scopus Author ID, un botón abre su perfil de Scopus (índice h oficial).

---

## 10. Copias de seguridad
En **Configuración → Copias de seguridad**:
- Escriba una contraseña (mínimo 10 caracteres) para crear una **copia cifrada**. Sin la contraseña nadie puede abrirla; **si la olvida no se puede recuperar**.
- La copia incluye su llave privada de firma (para proyectos compartidos): guárdela en un lugar seguro.
- Las claves de Scopus y de IA no se guardan en la copia (se vuelven a pegar).
- Puede incluir o no los **PDF adjuntos** (sin ellos la copia es más liviana; se conservan subrayados y texto).
- «Restaurar» reemplaza todo lo actual por la copia.

---

## 11. Análisis con IA (opcional)
La IA **solo** recibe publicaciones reales (de su biblioteca, de PubMed / Europe PMC o el texto que usted pegue) y BioCiencia verifica cada respuesta **sin IA**:
- un número de cita que no corresponde a una fuente se reemplaza por `[?]` y se avisa;
- cada frase «citada» se busca letra por letra en el resumen: ✓ verificada o ✗ no aparece.

Tres usos:
1. **Preguntar a mi biblioteca** (puede pegar además el texto de un artículo o PDF).
2. **Evidencia para una afirmación**: clasifica las publicaciones en apoya / refuta / mixto / no trata el tema y muestra el **medidor de evidencia** (barra verde/ámbar/roja). Un «apoya» sin frase verificable no se cuenta, y los artículos retractados no entran en el medidor.
3. **Verificar una cita**: ¿el artículo citado respalda lo que se le atribuye?

### Configurar
- **Ollama (privado y gratis, recomendado)**: instale Ollama desde https://ollama.com, abra una terminal y descargue un modelo, por ejemplo `ollama pull qwen2.5:7b` (≈4,7 GB; con 8 GB de RAM use `llama3.2:3b`, ≈2 GB). Abra BioCiencia con el doble clic (dirección `http://127.0.0.1:5173`) → Análisis con IA → «Detectar modelos» → «Probar conexión» → «Guardar».
  - Si usa `npm.cmd run dev:web` (dirección `localhost:5173`), Ollama la rechaza por defecto: use la dirección `http://127.0.0.1:5173` o defina la variable de entorno `OLLAMA_ORIGINS=http://localhost:5173`.
- **LM Studio** (privado): active el servidor local (puerto 1234).
- **Servicios en la nube** (OpenAI, Anthropic, Groq, OpenRouter): pago por uso con su propia clave y **solo si marca la autorización** de envío de datos.
  - **OpenAI (ChatGPT)**: se consulta desde su propia computadora con el puente local `/api/openai`, porque OpenAI no permite que el navegador lea sus respuestas. Al abrirlo con «Iniciar BioCiencia» funciona; en modo desarrollo puede avisar de que no pudo responder.
  - **Ojo: una suscripción no es una clave.** Pagar ChatGPT Plus/Pro **no** sirve para conectarlo a BioCiencia: la clave de API se crea aparte en `platform.openai.com` y se paga por uso (resumir unos cuantos artículos cuesta céntimos). Lo mismo vale para Claude: los planes de pago y la Consola de Anthropic son productos distintos con facturación separada.

**Límites honestos**: la IA lee los resúmenes y, si la publicación tiene PDF adjunto, sus pasajes más relacionados con la pregunta (no el PDF entero, para no superar lo que el modelo puede leer). La calidad depende del modelo: los modelos pequeños se equivocan más; por eso existe la verificación. Revise siempre las fuentes.

---

## 12. Privacidad y seguridad (resumen)
- Sus datos quedan en su navegador/computadora. Solo se envía a cada base de datos el texto de búsqueda (y su correo si lo configuró).
- La aplicación solo puede conectarse a una lista fija de servicios científicos (política de seguridad de contenido).
- Detalles: `docs/SEGURIDAD.md`.

---

## 13. Qué no hace BioCiencia
- No descarga artículos de fuentes no autorizadas (Sci-Hub u otras).
- No trae datos de Google Académico (no tiene API pública).
- No suma ni calcula índices con las citas de Scopus (condiciones de Elsevier).
- No tiene editor de manuscritos (se retiró en la versión 1.1); para escribir use Word con la bibliografía que genera BioCiencia.
- No inserta citas dentro de Word mientras escribe (complemento de Word: pendiente).
- No reconoce texto en PDF escaneados (OCR).

---

## 14. Licencia
BioCiencia es **libre y gratuita** (licencia MIT): puede usarla, copiarla, modificarla y compartirla con su grupo u otras instituciones sin costo.

Incluye componentes de terceros, también libres: pdf.js (Mozilla, Apache 2.0), citeproc-js (Frank Bennett, CPAL 1.0), los estilos y traducciones del proyecto Citation Style Language (https://citationstyles.org/, CC BY-SA 3.0) y SQLite (dominio público). Detalles en `TERCEROS.md`.
