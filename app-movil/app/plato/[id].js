import { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { obtenerPlatoPorId } from '../../src/services/menuService';
import { colores, espaciado, radios } from '../../src/theme';
import { formatearPrecio } from '../../src/utils/formato';
import { ALERGENOS_MAP, ETIQUETAS_MAP } from '../../src/constants/dieta';
import Card from '../../src/components/ui/Card';
import Badge from '../../src/components/ui/Badge';
import Button from '../../src/components/ui/Button';

export default function PlatoDetalleScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const idClave = String(id ?? '');
  const [estadoCarga, setEstadoCarga] = useState({
    idCargado: null,
    plato: null,
    error: null,
  });

  useEffect(() => {
    let activo = true;

    obtenerPlatoPorId(id)
      .then((encontrado) => {
        if (!activo) return;
        setEstadoCarga({ idCargado: idClave, plato: encontrado, error: null });
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

  if (cargando) {
    return (
      <View style={styles.centro}>
        <ActivityIndicator size="large" color={colores.primario} />
      </View>
    );
  }

  if (error || !plato) {
    return (
      <View style={styles.centro}>
        <Card style={styles.errorCard}>
          <Text style={styles.errorTitulo}>
            {error || 'No encontramos este plato'}
          </Text>
          <Button variante="secundario" onPress={() => router.back()}>
            Volver al menú
          </Button>
        </Card>
      </View>
    );
  }

  const agotado = plato.disponible === false;

  const manejarAccionPrincipal = () => {
    if (agotado) return;
    if (plato.personalizable) {
      router.push(`/armar/${plato.id}`);
      return;
    }
    Alert.alert('Carrito', `${plato.nombre} listo para agregar en la Fase 3.`);
  };

  return (
    <ScrollView style={styles.pantalla} contentContainerStyle={styles.contenido}>
      {plato.imagen ? (
        <Image
          source={{ uri: plato.imagen }}
          style={styles.imagenGrande}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.sinImagenGrande}>
          <Text style={styles.sinImagenTexto}>SIN IMAGEN</Text>
        </View>
      )}

      <View style={styles.cuerpo}>
        {agotado && (
          <Badge variante="alerta">Agotado · No disponible por ahora</Badge>
        )}

        <Text style={styles.nombre}>{plato.nombre}</Text>

        <View style={styles.metaRow}>
          <Text style={styles.precio}>
            {plato.personalizable ? 'Desde ' : ''}
            {formatearPrecio(plato.precio)}
          </Text>
          {plato.calorias != null ? (
            <Badge variante="neutro">{plato.calorias} kcal</Badge>
          ) : null}
          {plato.tiempo_estimado != null ? (
            <Badge variante="neutro">{plato.tiempo_estimado} min</Badge>
          ) : null}
        </View>

        {plato.etiquetas?.length > 0 && (
          <View style={styles.chipsWrap}>
            {plato.etiquetas.map((tag) => (
              <Badge key={tag}>
                {ETIQUETAS_MAP[tag]?.label || tag.replace('_', ' ')}
              </Badge>
            ))}
          </View>
        )}

        {plato.descripcion ? (
          <Text style={styles.descripcion}>{plato.descripcion}</Text>
        ) : null}

        <Card style={styles.alergenosCard}>
          <Text style={styles.seccionTitulo}>ALÉRGENOS</Text>
          {plato.alergenos?.length > 0 ? (
            <View style={styles.chipsWrap}>
              {plato.alergenos.map((al) => (
                <Badge key={al} variante="alerta">
                  {ALERGENOS_MAP[al] || al}
                </Badge>
              ))}
            </View>
          ) : (
            <Text style={styles.sinAlergenos}>Sin alérgenos declarados</Text>
          )}
        </Card>

        <Button
          disabled={agotado}
          onPress={manejarAccionPrincipal}
          style={styles.accionBtn}
        >
          {agotado
            ? 'No disponible'
            : plato.personalizable
              ? 'Armar mi plato'
              : 'Agregar al carrito'}
        </Button>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pantalla: {
    flex: 1,
    backgroundColor: colores.fondo,
  },
  contenido: {
    paddingBottom: espaciado.xxl,
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
  imagenGrande: {
    width: '100%',
    height: 260,
    backgroundColor: colores.superficie2,
  },
  sinImagenGrande: {
    width: '100%',
    height: 200,
    backgroundColor: colores.superficie2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sinImagenTexto: {
    color: colores.textoTenue,
    fontWeight: '700',
  },
  cuerpo: {
    padding: espaciado.lg,
    gap: espaciado.md,
  },
  nombre: {
    color: colores.texto,
    fontSize: 28,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
    flexWrap: 'wrap',
  },
  precio: {
    color: colores.texto,
    fontSize: 24,
    fontWeight: '800',
    marginRight: espaciado.xs,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: espaciado.xs + 2,
  },
  descripcion: {
    color: colores.textoSuave,
    fontSize: 15,
    lineHeight: 22,
  },
  alergenosCard: {
    gap: espaciado.sm,
    borderRadius: radios.lg,
  },
  seccionTitulo: {
    color: colores.textoSuave,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  sinAlergenos: {
    color: colores.textoTenue,
    fontSize: 13,
    fontStyle: 'italic',
  },
  accionBtn: {
    marginTop: espaciado.sm,
  },
});
