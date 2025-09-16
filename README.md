# TopABII - Plataforma de Competición TSP

TopABII es una aplicación web desarrollada para la Universidad Rey Juan Carlos que permite la gestión de competiciones del Problema del Viajante de Comercio (TSP).

## Características Principales

- **Sistema de usuarios** con registro y autenticación
- **Panel de administración** para gestión de usuarios e instancias TSP
- **Subida y validación** de soluciones TSP en tiempo real
- **Ranking dinámico** con ordenación por valor objetivo y fecha
- **Exportación CSV** de todas las soluciones
- **Diseño responsive** con colores institucionales de la URJC

## Tecnologías Utilizadas

- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Backend**: Node.js, Express.js
- **Base de Datos**: SQLite
- **Autenticación**: bcrypt + express-session
- **Estilo**: CSS personalizado con colores URJC (rojo, negro, blanco)

## Instalación y Configuración

### Requisitos Previos
- Node.js (versión 14 o superior)
- npm

### Pasos de Instalación

1. **Clonar/descargar el proyecto**
   ```bash
   cd topabii
   ```

2. **Instalar dependencias**
   ```bash
   npm install
   ```

3. **Iniciar el servidor**
   ```bash
   npm start
   ```
   
   Para desarrollo con auto-recarga:
   ```bash
   npm run dev
   ```

4. **Acceder a la aplicación**
   - Abrir navegador en: `http://localhost:3000`

## Credenciales por Defecto

- **Usuario administrador**:
  - Email: `sergio.cavero@urjc.es`
  - Contraseña: `admin`
  - **Importante**: Debes cambiar la contraseña en el primer acceso

## Estructura del Proyecto

```
topabii/
├── server.js              # Servidor principal Express
├── database.js            # Configuración y esquema de SQLite
├── package.json           # Dependencias y scripts
├── topabii.db             # Base de datos SQLite (se crea automáticamente)
├── public/                # Archivos frontend
│   ├── index.html         # Página principal
│   ├── login.html         # Página de login
│   ├── admin.html         # Panel de administración
│   ├── user.html          # Panel de usuario
│   ├── ranking.html       # Página de ranking público
│   ├── styles.css         # Estilos CSS con tema URJC
│   ├── app.js             # Funciones JavaScript comunes
│   ├── login.js           # Lógica de inicio de sesión
│   ├── admin.js           # Funcionalidad del panel admin
│   ├── user.js            # Funcionalidad del panel usuario
│   └── ranking.js         # Lógica del ranking público
└── README.md              # Esta documentación
```

## Funcionalidades Detalladas

### Para Administradores

1. **Crear Usuarios**
   - Introducir emails separados por `;`
   - Los usuarios se crean con su email como contraseña inicial
   - Obligatorio cambio de contraseña en primer acceso

2. **Subir Instancia TSP**
   - Definir nombre y número de nodos
   - Introducir matriz de distancias en formato JSON
   - Validación automática de formato y simetría

3. **Control del Ranking**
   - Congelar/descongelar visualización del ranking
   - Las soluciones siguen procesándose en segundo plano

4. **Exportar Datos**
   - Descargar CSV con todas las soluciones
   - Incluye: usuario, solución, valor objetivo, fecha/hora, validez

### Para Usuarios

1. **Subir Soluciones**
   - Formato: `1, 2, 3, 4, 5` (números separados por comas)
   - Validación automática de formato
   - Cálculo automático del valor objetivo
   - Solo se guarda la mejor solución de cada usuario

2. **Ver Estadísticas Personales**
   - Mejor valor objetivo
   - Número total de envíos
   - Fecha de última mejora

3. **Cambiar Contraseña**
   - Actualización segura de credenciales

### Ranking Público

- **Acceso libre** (sin necesidad de autenticación)
- **Ordenación**: Por valor objetivo (menor mejor), luego por fecha (más reciente mejor)
- **Podio visual**: Destacado especial para top 3 posiciones
- **Actualización automática** cada 30 segundos
- **Estadísticas generales**: Participantes, mejor solución, total envíos

## API Endpoints

### Autenticación
- `POST /api/login` - Iniciar sesión
- `POST /api/logout` - Cerrar sesión
- `POST /api/change-password` - Cambiar contraseña
- `GET /api/user` - Obtener información del usuario actual

### Administración (requiere permisos admin)
- `POST /api/admin/create-users` - Crear nuevos usuarios
- `POST /api/admin/upload-tsp` - Subir instancia TSP
- `POST /api/admin/toggle-ranking` - Congelar/descongelar ranking
- `GET /api/admin/export-csv` - Exportar datos CSV

### Usuario
- `POST /api/submit-solution` - Enviar solución TSP
- `GET /api/ranking` - Obtener ranking actual

## Validaciones Implementadas

### Soluciones TSP
- Todos los nodos presentes (1 hasta N)
- Sin números duplicados
- Formato numérico válido
- Cálculo correcto del valor objetivo

### Matriz de Distancias
- Formato JSON válido
- Tamaño correcto (N×N)
- Simetría
- Diagonal de ceros
- Valores no negativos

## Seguridad

- **Contraseñas hasheadas** con bcrypt
- **Sesiones seguras** con express-session
- **Validación de entrada** en cliente y servidor
- **Control de acceso** por roles (admin/usuario)
- **Sanitización HTML** para prevenir XSS

## Estilo Visual URJC

El diseño sigue la identidad visual de la Universidad Rey Juan Carlos:

- **Colores principales**: 
  - Rojo URJC: `#C41E3A`
  - Negro: `#1A1A1A`
  - Blanco: `#FFFFFF`
  - Grises complementarios

- **Tipografía**: Arial, sans-serif
- **Estilo**: Limpio, académico, profesional
- **Responsive**: Adaptado a dispositivos móviles

## Base de Datos

### Tablas Principales

1. **users** - Información de usuarios
2. **tsp_instances** - Instancias del problema TSP
3. **solutions** - Todas las soluciones enviadas
4. **user_best_solutions** - Mejores soluciones por usuario
5. **system_settings** - Configuración del sistema

## Ejemplo de Uso

1. **Inicio como Admin**:
   - Acceder con `admin` / `admin`
   - Crear usuarios: `user1@urjc.es; user2@urjc.es`
   - Subir instancia TSP de ejemplo (4 ciudades)

2. **Como Usuario**:
   - Login con email asignado
   - Cambiar contraseña obligatoria
   - Enviar solución: `1, 2, 3, 4`
   - Ver posición en ranking

3. **Ranking Público**:
   - Visible en `/ranking` sin autenticación
   - Se actualiza automáticamente

## Soporte y Mantenimiento

- **Logs**: El servidor muestra información en consola
- **Base de datos**: Archivo `topabii.db` en directorio raíz
- **Backup**: Realizar copia de `topabii.db` regularmente
- **Reinicio**: `npm start` o reinicio del proceso Node.js

## Licencia

Desarrollado para la Universidad Rey Juan Carlos - 2024