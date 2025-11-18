import React, { useState, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert } from 'react-native';
import { Camera, CameraView } from 'expo-camera';
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { CameraScreenNavigationProp } from '../types/navigation';

type CameraScreenProps = {
  navigation: CameraScreenNavigationProp;
};

export default function CameraScreen({ navigation }: CameraScreenProps) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [isProcessing, setIsProcessing] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  React.useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');

      // Load TensorFlow.js model
      await tf.ready();
      console.log('TensorFlow.js loaded');
    })();
  }, []);

  const processImageWithAI = async (imageUri: string) => {
    try {
      setIsProcessing(true);

      // Load COCO-SSD model
      const model = await cocoSsd.load();

      // Create image element from URI
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = imageUri;

      return new Promise<any[]>((resolve, reject) => {
        img.onload = async () => {
          try {
            const predictions = await model.detect(img);
            resolve(predictions);
          } catch (error) {
            reject(error);
          }
        };
        img.onerror = () => reject(new Error('Failed to load image'));
      });
    } catch (error) {
      console.error('Error loading AI model:', error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  };

  const takePicture = async () => {
    if (cameraRef.current && !isProcessing) {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.7,
          base64: false,
        });
        console.log('Photo taken:', photo.uri);

        // Process with AI
        const predictions = await processImageWithAI(photo.uri);
        console.log('AI predictions:', predictions);

        // Extract relevant junk items and their confidence
        const junkItems = predictions
          .filter((pred: any) => pred.score > 0.3) // Confidence threshold
          .map((pred: any) => `${pred.class} (${Math.round(pred.score * 100)}%)`)
          .slice(0, 5); // Top 5 detections

        const itemCount = predictions.filter((pred: any) => pred.score > 0.5).length;
        const estimateMessage = `Detected ${itemCount} items: ${junkItems.join(', ')}`;

        Alert.alert(
          'AI Analysis Complete! 🤖',
          estimateMessage,
          [{ text: 'Take Another Photo' }, { text: 'Done', onPress: () => navigation.goBack() }]
        );
      } catch (error) {
        console.error('Error processing photo:', error);
        Alert.alert('Processing Error', 'Failed to analyze image. Camera working, AI processing failed.');
      }
    }
  };

  const toggleCameraFacing = () => {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  if (hasPermission === null) {
    return <View style={styles.container}><Text>Requesting camera permission...</Text></View>;
  }
  if (hasPermission === false) {
    return <View style={styles.container}><Text>No access to camera</Text></View>;
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing={facing}
        ref={cameraRef}
        mode="picture"
      >
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.button} onPress={toggleCameraFacing}>
            <Text style={styles.text}>🔄</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.captureButton} onPress={takePicture}>
            <Text style={styles.captureText}>📸</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.button} onPress={() => navigation.goBack()}>
            <Text style={styles.text}>✖️</Text>
          </TouchableOpacity>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  buttonContainer: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'transparent',
    margin: 64,
  },
  button: {
    flex: 1,
    alignSelf: 'flex-end',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 10,
    marginHorizontal: 10,
    borderRadius: 50,
  },
  captureButton: {
    flex: 0,
    alignSelf: 'flex-end',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 50,
    borderWidth: 4,
    borderColor: '#f39c12',
  },
  text: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  captureText: {
    fontSize: 24,
    color: 'black',
  },
});
