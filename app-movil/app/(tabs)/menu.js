import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  Image,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  obtenerCategorias,
  obtenerPlatos,
  obtenerPlatosArmables,
  obtenerConfiguracion,
  recargarMenu,
  esModoDemo,
} from '../../src/services/menuService';
import { colores, espaciado, radios } from '../../src/theme';
import { formatearPrecio } from '../../src/utils/formato';
import CategoriaFiltro from '../../src/components/menu/CategoriaFiltro';
import PlatoCard from '../../src/components/menu/PlatoCard';
import Card from '../../src/components/ui/Card';
import Button from '../../src/components/ui/Button';
import ProvisionalBanner from '../../src/components/ui/ProvisionalBanner';

export default function MenuScreen() {
  const router = useRouter();
  const [categorias, setCategorias] = useState([]);
  const [platos, setPlatos] = useState([]);
  const [armables, setArmables] = useState([]);
  const [config, setConfig] = useState({ nombre: 'SmartDining', moneda: 'COP' });
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState(null);

  const modoDemo = esModoDemo();

  const cargarMenu = useCallback(async ({ esRefresco = false } = {}) => {
    if (esRefresco) {
      setRefrescando(true);
      recargarMenu();
    } else {
      setCargando(true);
    }
    setError(null);

    try {
      const [cats, plats, arms, cfg] = await Promise.all([
        obtenerCategorias(),
        obtenerPlatos(),
        obtenerPlatosArmables(),
        obtenerConfiguracion(),
      ]);
      setCategorias(cats);
      setPlatos(plats);
      setArmables(Array.isArray(arms) ? arms : []);
      if (cfg) setConfig(cfg);
    } catch (err) {
      setError(err?.mensaje || err?.message || 'No pudimos cargar el menú.');
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }, []);

  useEffect(() => {
    let activo = true;
    Promise.all([
      obtenerCategorias(),
      obtenerPlatos(),
      obtenerPlatosArmables(),
      obtenerConfiguracion(),
    ])
      .then(([cats, plats, arms, cfg]) => {
        if (!activo) return;
        setError(null);
        setCategorias(cats);
        setPlatos(plats);
        setArmables(Array.isArray(arms) ? arms : []);
        if (cfg) setConfig(cfg);
      })
      .catch((err) => {
        if (!activo) return;
        setError(err?.mensaje || err?.message || 'No pudimos cargar el menú.');
      })
      .finally(() => {
        if (activo) setCargando(false);
      });

    return () => {
      activo = false;
    };
  }, []);

  const platosFiltrados = useMemo(() => {
    if (categoriaSeleccionada === null) return platos;
    return platos.filter((p) => p.categoriaId === categoriaSeleccionada);
  }, [platos, categoriaSeleccionada]);

  if (cargando) {
    return (
      <View style={styles.estadoCentro}>
        <ActivityIndicator size="large" color={colores.primario} />
        <Text style={styles.estadoTexto}>Cargando menú...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.estadoCentro}>
        <Card style={styles.errorCard}>
          <Text style={styles.errorTitulo}>No pudimos cargar el menú</Text>
          <Text style={styles.errorMensaje}>{error}</Text>
          <Button
            onPress={() => {
              recargarMenu();
              cargarMenu();
            }}
          >
            Reintentar
          </Button>
        </Card>
      </View>
    );
  }

  const renderHeader = () => (
    <View style={styles.headerBloque}>
      {modoDemo && (
        <ProvisionalBanner
          variante="demo"
          titulo="Modo demo"
          descripcion="EXPO_PUBLIC_API_URL no está configurada. Mostrando menú de ejemplo local."
        />
      )}

      <View style={styles.heroHeader}>
        <Text style={styles.heroEyebrow}>
          {(config?.nombre || 'SmartDining').toUpperCase()} · PARA LLEVAR Y DOMICILIO
        </Text>
        <Text style={styles.heroTitulo}>NUESTRO MENÚ</Text>
      </View>

      {armables.length > 0 && (
        <View style={styles.seccion}>
          <View style={styles.seccionHeader}>
            <Text style={styles.seccionTitulo}>ARMA TU PLATO</Text>
            <Text style={styles.seccionSub}>Paso a paso a tu gusto</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.armablesLista}
          >
            {armables.map((plato) => (
              <Card key={plato.id_plato} style={styles.armableCard}>
                {plato.url_imagen ? (
                  <Image
                    source={{ uri: plato.url_imagen }}
                    style={styles.armableImagen}
                    resizeMode="cover"
                  />
                ) : null}
                <Text style={styles.armableNombre} numberOfLines={1}>
                  {plato.nombre}
                </Text>
                <View style={styles.armableMeta}>
                  <Text style={styles.armablePrecio}>
                    Desde {formatearPrecio(plato.precio)}
                  </Text>
                  {plato.calorias != null ? (
                    <Text style={styles.armableCalorias}>
                      ≈ {plato.calorias} kcal
                    </Text>
                  ) : null}
                </View>
                <Button
                  onPress={() => router.push(`/armar/${plato.id_plato}`)}
                  style={styles.armableBtn}
                >
                  Armar mi plato
                </Button>
                <Button
                  variante="secundario"
                  onPress={() => router.push(`/plato/${plato.id_plato}`)}
                  style={styles.armableBtn}
                >
                  Ver detalle
                </Button>
              </Card>
            ))}
          </ScrollView>
        </View>
      )}

      <CategoriaFiltro
        categorias={categorias}
        categoriaSeleccionada={categoriaSeleccionada}
        onSeleccionar={setCategoriaSeleccionada}
      />
    </View>
  );

  return (
    <FlatList
      style={styles.lista}
      contentContainerStyle={styles.listaContenido}
      data={platosFiltrados}
      keyExtractor={(item) => String(item.id)}
      ListHeaderComponent={renderHeader}
      renderItem={({ item }) => (
        <PlatoCard
          plato={item}
          onPress={(plato) => router.push(`/plato/${plato.id}`)}
        />
      )}
      ListEmptyComponent={
        <Card style={styles.vacioCard}>
          <Text style={styles.vacioTitulo}>No hay platos en esta categoría</Text>
          <Text style={styles.vacioTexto}>
            Prueba seleccionando otra categoría o la opción &quot;TODAS&quot;.
          </Text>
        </Card>
      }
      refreshControl={
        <RefreshControl
          refreshing={refrescando}
          onRefresh={() => cargarMenu({ esRefresco: true })}
          tintColor={colores.primario}
          colors={[colores.primario]}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  lista: {
    flex: 1,
    backgroundColor: colores.fondo,
  },
  listaContenido: {
    padding: espaciado.lg,
    gap: espaciado.md,
    paddingBottom: espaciado.xxl,
  },
  estadoCentro: {
    flex: 1,
    backgroundColor: colores.fondo,
    justifyContent: 'center',
    alignItems: 'center',
    padding: espaciado.lg,
    gap: espaciado.md,
  },
  estadoTexto: {
    color: colores.textoSuave,
    fontSize: 14,
  },
  errorCard: {
    width: '100%',
    gap: espaciado.md,
    alignItems: 'stretch',
  },
  errorTitulo: {
    color: colores.texto,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  errorMensaje: {
    color: colores.textoSuave,
    fontSize: 13,
    textAlign: 'center',
  },
  headerBloque: {
    gap: espaciado.md,
    marginBottom: espaciado.xs,
  },
  heroHeader: {
    gap: 4,
  },
  heroEyebrow: {
    color: colores.primarioTexto,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  heroTitulo: {
    color: colores.primario,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 1,
  },
  seccion: {
    gap: espaciado.sm,
  },
  seccionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  seccionTitulo: {
    color: colores.texto,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  seccionSub: {
    color: colores.textoSuave,
    fontSize: 12,
  },
  armablesLista: {
    gap: espaciado.md,
  },
  armableCard: {
    width: 230,
    padding: espaciado.md,
    gap: espaciado.sm,
  },
  armableImagen: {
    width: '100%',
    height: 120,
    borderRadius: radios.md,
    backgroundColor: colores.superficie2,
  },
  armableNombre: {
    color: colores.texto,
    fontSize: 16,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  armableMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  armablePrecio: {
    color: colores.texto,
    fontSize: 14,
    fontWeight: '700',
  },
  armableCalorias: {
    color: colores.textoSuave,
    fontSize: 12,
  },
  armableBtn: {
    minHeight: 42,
    paddingVertical: 8,
  },
  vacioCard: {
    alignItems: 'center',
    gap: espaciado.xs,
    paddingVertical: espaciado.xl,
  },
  vacioTitulo: {
    color: colores.texto,
    fontSize: 16,
    fontWeight: '700',
  },
  vacioTexto: {
    color: colores.textoSuave,
    fontSize: 13,
    textAlign: 'center',
  },
});
