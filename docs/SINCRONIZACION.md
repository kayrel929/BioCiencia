# Sincronización entre computadoras (Fase 5)

## Qué se sincroniza y qué no

| Se sincroniza | No sale de su computadora |
| --- | --- |
| Proyectos **compartidos**: nombre, descripción, objetivos, participantes y roles, bibliografía, notas | Biblioteca personal, etiquetas, favoritos, colecciones, historial de búsquedas, proyectos privados, configuración, llave privada |

Un proyecto empieza siendo **privado**. Solo el administrador puede pulsar **Compartir proyecto**.

## Cómo funciona

1. Cada identidad tiene un par de llaves **Ed25519**. Se crean con la Web Crypto nativa de Windows/WebView2 o del navegador; no se usa ninguna librería adicional. La llave privada se guarda solo en la base local.
2. Cada cambio en un proyecto compartido se convierte en un **evento inmutable**. Un evento lleva:
   - un id ULID;
   - un reloj lógico híbrido (HLC);
   - el autor y la llave pública del autor;
   - una **firma** sobre su contenido en JSON canónico.
3. Los eventos se escriben en una carpeta con esta forma: `<carpeta>/<idProyecto>/<idDispositivo>.ndjson`.
   - Cada computadora **solo agrega líneas a su propio archivo**. Nunca hay dos equipos escribiendo el mismo archivo, así que no se producen conflictos de copia.
4. Al sincronizar, cada computadora lee los archivos de las demás y sigue estos pasos:
   1. Descarta las líneas incompletas (aún copiándose), el JSON inválido y las **firmas que no verifican**.
   2. Guarda los eventos nuevos. Los repetidos se ignoran por su id, así que sincronizar dos veces no duplica nada.
   3. **Reproduce** todos los eventos del proyecto en orden HLC con una función pura (`replayProject`). Dos computadoras con los mismos eventos llegan exactamente al mismo estado, sin importar el orden en que los recibieron.
   4. Verifica los permisos en cada evento:
      - el autor debe ser miembro, con la misma llave que se registró al invitarlo;
      - los lectores no modifican;
      - solo los administradores gestionan miembros o archivan;
      - siempre queda al menos un administrador.
   5. Si dos personas cambian **el mismo campo** sin estar sincronizadas, gana el cambio con HLC mayor. El otro queda en el **historial** marcado como «reemplazado». Los cambios a campos distintos se combinan.
   6. Un mismo artículo con identificadores distintos en cada computadora (por ejemplo, DOI en una y PMID en otra) se une en una sola entrada.
5. Quien **no es miembro** puede recibir los archivos, pero BioCiencia no le muestra el proyecto. Si a alguien lo retiran, el proyecto desaparece de su lista en la siguiente sincronización.

### Invitar

1. La persona invitada copia su **código de investigador** desde Sincronización. El código tiene la forma `BC1-…` e incluye su nombre, su id y su llave **pública**. No contiene contraseñas ni la llave privada.
2. El administrador pega el código en el proyecto, en **Invitar con el código de investigador**, y elige un rol: administrador, editor o lector.

## Transporte

- **Windows, automático:** en Sincronización, elija una carpeta que se copie entre sus PC y active «Sincronizar automáticamente cada 30 segundos». Esa carpeta puede ser:
  - una carpeta de **Syncthing** (recomendado: software libre, copia directa entre equipos, sin servidor propio de terceros);
  - una carpeta de red compartida;
  - una memoria USB que se lleva de un equipo a otro.
- **Web o manual:** use **Exportar paquete** e **Importar paquete**. Es un archivo `.json` que puede enviar por correo o llevar en una USB. El paquete no contiene la llave privada.

Seguridad de los comandos de Windows: `sync_list`, `sync_read` y `sync_append` solo aceptan nombres con forma de ULID. No pueden salir de la carpeta elegida, porque no aceptan `..`, barras ni rutas relativas. Además, leen como máximo 64 MB por archivo. La carpeta se elige con el diálogo nativo.

## Prueba real con dos PC Windows (pendiente, la hace usted)

Lo que **sí** se probó, en un solo entorno de desarrollo:

- 14 pruebas que simulan dos o tres nodos, cada uno con su propia base SQLite en disco y una carpeta compartida.
- 3 pruebas de firmas.
- 2 pruebas en Rust de la carpeta de sincronización.
- Una prueba de interfaz con dos navegadores aislados que intercambian paquetes.

Lo que **no** se ha probado: dos computadoras físicas con Syncthing. Pasos:

1. En **ambas PC**, instale Syncthing desde su sitio oficial, `syncthing.net`. *Instalar un programa requiere su autorización. No lo hago yo.*
2. En la PC 1, cree una carpeta, por ejemplo `C:\Users\<usuario>\BioCiencia-sync`. Compártala en Syncthing con la PC 2 y acéptela en la PC 2.
3. En cada PC, abra BioCiencia, vaya a **Sincronización**, pulse **Elegir carpeta** (la carpeta de Syncthing) y active la sincronización automática.
4. En la PC 2, copie el código de investigador y envíelo a la PC 1. Si en la PC 2 se usa la misma persona, cree en ella una identidad distinta, o restaure una copia de seguridad (ver la nota de abajo).
5. En la PC 1, cree un proyecto, pulse **Compartir proyecto**, invite con el código y pulse **Sincronizar ahora**.
6. Compruebe en la PC 2, tras unos segundos:
   - que el proyecto aparece;
   - que puede editarlo;
   - que el cambio llega a la PC 1;
   - que una edición simultánea del nombre en ambas deja una sola versión y la otra queda en el historial.
7. Anote lo que vea en el registro de Sincronización de ambas PC.

> **La misma persona en dos PC:** restaurar una copia de seguridad en la segunda PC copia su identidad y su llave. Al restaurar, BioCiencia le asigna a esa PC un **id de dispositivo nuevo**, para que cada equipo escriba en su propio archivo.

## Límites conocidos de esta versión

- Las notas y la bibliografía se combinan, pero el texto largo **no** se edita a la vez entre varias personas. La edición colaborativa en tiempo real (CRDT) es la Fase 8.
- Retirar a un miembro le impide ver el proyecto en BioCiencia y hace que sus cambios posteriores se rechacen. Los archivos que **ya** recibió en su carpeta siguen en su disco: los eventos están firmados, no cifrados. El cifrado de extremo a extremo de cada proyecto queda para la Fase 11.
- Un reloj adelantado más de 5 minutos no adelanta el reloj local, pero su evento se ordena con su propia marca de tiempo.
