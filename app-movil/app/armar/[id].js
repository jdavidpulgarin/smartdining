import { useEffect, useMemo, useReducer, useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TextInput,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { obtenerPlatoArmable } from '../../src/services/menuService';
import {
  constructorReducer,
  estadoInicial,
} from '../../src/components/constructor/constructorReducer';
import PasoConstructor from '../../src/components/constructor/PasoConstructor';
import {
  calcularPlato,
  pasosPendientes,
  validarPaso,
} from '../../src/utils/calcularPlato';
import { useCarrito } from '../../src/context/CarritoContext';
import { generarIdLinea } from '../../src/utils/id';
import { formatearPrecio } from '../../src/utils/formato';
import { urlImagen } from '../../src/utils/imagenes';
import { ALERGENOS_MAP } from '../../src/constants/dieta';
import { colores, espaciado, radios } from '../../src/theme';
import Card from '../../src/components/ui/Card';
import Button from '../../src/components/ui/Button';
import Badge from '../../src/components/ui/Badge';

const ETIQUETA_PORCION = {
  ligera: 'Ligera',
  normal: 'Normal',
  extra: 'Extra',
};

export default function ArmarPlatoScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { agregarLinea } = useCarrito();

  const idClave = String(id ?? '');
  const [estadoCarga, setEstadoCarga] = useState({
    idCargado: null,
    plato: null,
    error: null,
  });
  const [estado, despachador] = useReducer(constructorReducer, estadoInicial);

  useEffect(() => {
    let activo = true;

    obtenerPlatoArmable(id)
      .then((resultado) => {
        if (!activo) return;
        setEstadoCarga({ idCargado: idClave, plato: resultado, error: null });
      })
      .catch((err) => {
        if (!activo) return;
        setEstadoCarga({
          idCargado: idClave,
          plato: null,
          error: err?.mensaje || err?.message || 'No pudimos cargar el plato.',
        });
      });

    return () => {
      activo = false;
    };
  }, [id, idClave]);

  const cargando = estadoCarga.idCargado !== idClave;
  const plato = cargando ? null : estadoCarga.plato;
  const error = cargando ? null : estadoCarga.error;

  const calculo = useMemo(
    () => calcularPlato(plato, estado.selecciones),
    [plato, estado.selecciones]
  );

  const pendientes = useMemo(
    () => pasosPendientes(plato, estado.selecciones),
    [plato, estado.selecciones]
  );

  if (cargando) {
    return (
      <View style={styles.centro}>
        <ActivityIndicator size="large" color={colores.primario} />
      </View>
    );
  }

  if (error || !plato || plato.disponible === false) {
    return (
      <View style={styles.centro}>
        <Card style={styles.errorCard}>
          <Text style={styles.errorTitulo}>
            {error || 'Este plato armable no está disponible'}
          </Text>
          <Button variante="secundario" onPress={() => router.back()}>
            Volver al menú
          </Button>
        </Card>
      </View>
    );
  }

  const pasos = plato.pasos || [];
  const totalPasos = pasos.length;
  const esUltimoPaso = estado.pasoActual >= totalPasos - 1;
  const pasoActualObj = pasos[estado.pasoActual] || null;
  const seleccionesPasoActual = pasoActualObj
    ? estado.selecciones[pasoActualObj.id_paso] || {}
    : {};
  const validacionPaso = validarPaso(pasoActualObj, seleccionesPasoActual);
  const cumpleMinimo = validacionPaso.valido;
  const minSelActual = pasoActualObj ? Number(pasoActualObj.min_sel) || 0 : 0;
  const progresoPct =
    totalPasos > 0
      ? Math.round(
          ((estado.enResumen ? totalPasos : estado.pasoActual + 1) / totalPasos) *
            100
        )
      : 100;

  const manejarAnterior = () => {
    if (!estado.enResumen && estado.pasoActual === 0) {
      router.back();
      return;
    }
    despachador({ type: 'ANTERIOR' });
  };

  const manejarSiguiente = () => {
    if (!cumpleMinimo) return;
    despachador({ type: 'SIGUIENTE', totalPasos });
  };

  const manejarAgregarAlCarrito = () => {
    if (pendientes.length > 0) return;
    const notasLimpias = estado.notas.trim();

    agregarLinea({
      id_linea: generarIdLinea(),
      id_plato: plato.id_plato,
      nombre: plato.nombre,
      imagen: plato.url_imagen || null,
      cantidad: 1,
      precioUnitario: calculo.precio,
      calorias: calculo.calorias,
      ingredientes: calculo.ingredientes,
      detalle: calculo.detalle,
      notas: notasLimpias,
    });

    despachador({ type: 'REINICIAR' });
    router.replace('/(tabs)/carrito');
  };

  const imagenHeroUrl = urlImagen(plato.url_imagen);

  return (
    <View style={styles.pantalla}>
      <ScrollView contentContainerStyle={styles.contenido}>
        <View style={styles.heroCard}>
          {imagenHeroUrl ? (
            <Image
              source={{ uri: imagenHeroUrl }}
              style={styles.heroImagen}
              resizeMode="cover"
            />
          ) : null}
          <View style={styles.heroTexto}>
            <Text style={styles.heroNombre}>{plato.nombre}</Text>
            {plato.descripcion ? (
              <Text style={styles.heroDesc} numberOfLines={2}>
                {plato.descripcion}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.progresoBloque}>
          <View style={styles.progresoHeader}>
            <Text style={styles.progresoEtiqueta}>
              {estado.enResumen
                ? 'RESUMEN DE TU PLATO'
                : `PASO ${estado.pasoActual + 1} DE ${totalPasos}`}
            </Text>
            <Text style={styles.progresoPct}>{progresoPct}%</Text>
          </View>
          <View style={styles.progresoPista}>
            <View style={[styles.progresoRelleno, { width: `${progresoPct}%` }]} />
          </View>
        </View>

        {estado.enResumen ? (
          <Card style={styles.resumenCard}>
            <View style={styles.resumenTop}>
              <Text style={styles.resumenTitulo}>TU COMBINACIÓN</Text>
              <Button
                variante="secundario"
                onPress={manejarAnterior}
                style={styles.editarBtn}
              >
                Editar
              </Button>
            </View>

            {pasos.map((paso) => {
              const itemsPaso = calculo.detalle.filter(
                (d) => d.paso === paso.nombre
              );
              return (
                <View key={paso.id_paso} style={styles.resumenPaso}>
                  <Text style={styles.resumenPasoNombre}>{paso.nombre}</Text>
                  {itemsPaso.length === 0 ? (
                    <Text style={styles.sinSel}>Sin selección</Text>
                  ) : (
                    itemsPaso.map((item, idx) => (
                      <Text key={`${paso.id_paso}-${idx}`} style={styles.resumenItem}>
                        • {item.nombre} ({ETIQUETA_PORCION[item.porcion] || item.porcion})
                      </Text>
                    ))
                  )}
                </View>
              );
            })}

            <View style={styles.resumenSeccion}>
              <Text style={styles.resumenPasoNombre}>ALÉRGENOS</Text>
              {calculo.alergenos.length === 0 ? (
                <Text style={styles.sinSel}>Sin alérgenos declarados</Text>
              ) : (
                <View style={styles.chipsWrap}>
                  {calculo.alergenos.map((al) => (
                    <Badge key={al} variante="alerta">
                      {ALERGENOS_MAP[al] || al}
                    </Badge>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.resumenSeccion}>
              <View style={styles.notasHeader}>
                <Text style={styles.resumenPasoNombre}>NOTAS PARA COCINA</Text>
                <Text style={styles.notasContador}>
                  {estado.notas.length}/200
                </Text>
              </View>
              <TextInput
                value={estado.notas}
                onChangeText={(texto) =>
                  despachador({ type: 'CAMBIAR_NOTAS', notas: texto })
                }
                maxLength={200}
                multiline
                placeholder="Ej: Salsa aparte, bien cocido..."
                placeholderTextColor={colores.textoTenue}
                style={styles.inputNotas}
              />
            </View>

            {pendientes.length > 0 && (
              <Text style={styles.avisoPendientes}>
                Falta completar: {pendientes.join(', ')}
              </Text>
            )}
          </Card>
        ) : (
          <View style={styles.pasoCont}>
            <PasoConstructor
              paso={pasoActualObj}
              seleccionesDelPaso={seleccionesPasoActual}
              despachador={despachador}
            />
            {!cumpleMinimo && (
              <Text style={styles.avisoMinimo}>
                Elige al menos {minSelActual} para continuar
              </Text>
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.barraInferior}>
        <View style={styles.totalesRow}>
          <View>
            <Text style={styles.totalEtiqueta}>TOTAL EN VIVO</Text>
            <Text style={styles.totalPrecio}>{formatearPrecio(calculo.precio)}</Text>
          </View>
          <Badge variante="neutro">{calculo.calorias} kcal</Badge>
        </View>

        <View style={styles.botonesRow}>
          <Button
            variante="secundario"
            onPress={manejarAnterior}
            style={styles.btnFlex}
          >
            Anterior
          </Button>

          {estado.enResumen ? (
            <Button
              disabled={pendientes.length > 0}
              onPress={manejarAgregarAlCarrito}
              style={styles.btnFlexPrincipal}
            >
              Agregar al carrito
            </Button>
          ) : (
            <Button
              disabled={!cumpleMinimo}
              onPress={manejarSiguiente}
              style={styles.btnFlexPrincipal}
            >
              {esUltimoPaso ? 'Ver resumen' : 'Siguiente'}
            </Button>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pantalla: {
    flex: 1,
    backgroundColor: colores.fondo,
  },
  centro: {
    flex: 1,
    backgroundColor: colores.fondo,
    justifyContent: 'center',
    alignItems: 'center',
    padding: espaciado.lg,
  },
  errorCard: {
    width: '100%',
    gap: espaciado.md,
  },
  errorTitulo: {
    color: colores.texto,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  contenido: {
    padding: espaciado.lg,
    gap: espaciado.lg,
    paddingBottom: 150,
  },
  heroCard: {
    flexDirection: 'row',
    gap: espaciado.md,
    alignItems: 'center',
    backgroundColor: colores.superficie,
    borderRadius: radios.lg,
    borderWidth: 1,
    borderColor: colores.borde,
    padding: espaciado.md,
  },
  heroImagen: {
    width: 72,
    height: 72,
    borderRadius: radios.md,
    backgroundColor: colores.superficie2,
  },
  heroTexto: {
    flex: 1,
    gap: 4,
  },
  heroNombre: {
    color: colores.primario,
    fontSize: 20,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  heroDesc: {
    color: colores.textoSuave,
    fontSize: 12,
    lineHeight: 17,
  },
  progresoBloque: {
    gap: 6,
  },
  progresoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progresoEtiqueta: {
    color: colores.textoSuave,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  progresoPct: {
    color: colores.acento,
    fontSize: 12,
    fontWeight: '800',
  },
  progresoPista: {
    height: 6,
    borderRadius: radios.pill,
    backgroundColor: colores.superficie2,
    overflow: 'hidden',
  },
  progresoRelleno: {
    height: '100%',
    backgroundColor: colores.primario,
    borderRadius: radios.pill,
  },
  pasoCont: {
    gap: espaciado.sm,
  },
  avisoMinimo: {
    color: colores.primarioTexto,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  resumenCard: {
    gap: espaciado.md,
  },
  resumenTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resumenTitulo: {
    color: colores.texto,
    fontSize: 18,
    fontWeight: '800',
  },
  editarBtn: {
    minHeight: 38,
    paddingVertical: 6,
    paddingHorizontal: espaciado.md,
  },
  resumenPaso: {
    gap: 4,
    paddingTop: espaciado.sm,
    borderTopWidth: 1,
    borderTopColor: colores.borde,
  },
  resumenPasoNombre: {
    color: colores.textoSuave,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  resumenItem: {
    color: colores.texto,
    fontSize: 14,
  },
  sinSel: {
    color: colores.textoTenue,
    fontSize: 13,
    fontStyle: 'italic',
  },
  resumenSeccion: {
    gap: 6,
    paddingTop: espaciado.sm,
    borderTopWidth: 1,
    borderTopColor: colores.borde,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  notasHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  notasContador: {
    color: colores.textoSuave,
    fontSize: 11,
  },
  inputNotas: {
    backgroundColor: colores.superficie2,
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: radios.md,
    padding: espaciado.md,
    color: colores.texto,
    fontSize: 14,
    minHeight: 74,
    textAlignVertical: 'top',
  },
  avisoPendientes: {
    color: colores.primarioTexto,
    fontSize: 12,
    fontWeight: '700',
  },
  barraInferior: {
    backgroundColor: colores.superficie,
    borderTopWidth: 1,
    borderTopColor: colores.borde,
    padding: espaciado.lg,
    gap: espaciado.md,
  },
  totalesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalEtiqueta: {
    color: colores.textoSuave,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  totalPrecio: {
    color: colores.texto,
    fontSize: 22,
    fontWeight: '900',
  },
  botonesRow: {
    flexDirection: 'row',
    gap: espaciado.md,
  },
  btnFlex: {
    flex: 1,
  },
  btnFlexPrincipal: {
    flex: 2,
  },
});
